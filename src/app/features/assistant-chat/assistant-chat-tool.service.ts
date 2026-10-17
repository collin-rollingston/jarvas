import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { NoteService } from '../note/note.service';
import { Note } from '../note/note.model';
import { selectAllNotes } from '../note/store/note.reducer';
import { Project } from '../project/project.model';
import { ProjectService } from '../project/project.service';
import { selectAllProjects } from '../project/store/project.selectors';
import { Tag } from '../tag/tag.model';
import { TagService } from '../tag/tag.service';
import { TODAY_TAG } from '../tag/tag.const';
import { selectAllTags } from '../tag/store/tag.reducer';
import { Task, TaskPriority, TaskReminderOptionId } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { selectAllTasks } from '../tasks/store/task.selectors';
import {
  millisecondsDiffToRemindOption,
  remindOptionToMilliseconds,
} from '../tasks/util/remind-option-to-milliseconds';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import {
  DEFAULT_TASK_REPEAT_CFG,
  RepeatCycleOption,
  RepeatQuickSetting,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../task-repeat-cfg/task-repeat-cfg.model';
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { isDBDateStr } from '../../util/get-db-date-str';
import {
  moveTaskDownInTodayList,
  moveTaskToBottomInTodayList,
  moveTaskToTopInTodayList,
  moveTaskUpInTodayList,
} from '../work-context/store/work-context-meta.actions';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { WorkContextType } from '../work-context/work-context.model';
import { AssistantChatToolReadService } from './assistant-chat-tool-read.service';

type ToolArgs = Record<string, unknown>;
type ToolExecution =
  | { content: string; needsConfirmation?: false }
  | { content: string; needsConfirmation: true };
type PendingConfirmation = {
  code: string;
  expiresAt: number;
  execute: () => Promise<string>;
};

export type ConfirmationResolution =
  | { status: 'none' }
  | { status: 'continue'; code: string }
  | { status: 'handled'; content: string };

const MAX_MINUTES = 525600;
const CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const WEEKDAY_BY_INDEX = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

@Injectable({ providedIn: 'root' })
export class AssistantChatToolService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _projectService = inject(ProjectService);
  private readonly _tagService = inject(TagService);
  private readonly _noteService = inject(NoteService);
  private readonly _repeatService = inject(TaskRepeatCfgService);
  private readonly _dateService = inject(DateService);
  private readonly _router = inject(Router);
  private readonly _readTools = inject(AssistantChatToolReadService);
  private _pendingConfirmation?: PendingConfirmation;

  async execute(name: string, rawArgs: string): Promise<ToolExecution> {
    try {
      const args = this._parseArgs(rawArgs);
      switch (name) {
        case 'search_tasks':
        case 'get_task_details':
        case 'get_today_plan':
        case 'get_time_summary':
        case 'list_projects':
        case 'list_tags':
        case 'list_notes':
        case 'list_recurrences':
          return this._result(await this._readTools.execute(name, args));
        case 'create_task':
          return this._result(await this._createTask(args));
        case 'create_subtask':
          return this._result(await this._createSubtask(args));
        case 'update_task':
          return this._result(await this._updateTask(args));
        case 'set_task_completion':
          return this._result(await this._setTaskCompletion(args));
        case 'reorder_today_task':
          return this._result(await this._reorderTodayTask(args));
        case 'plan_task':
          return this._result(await this._planTask(args));
        case 'set_task_tags':
          return this._result(await this._setTaskTags(args));
        case 'move_task_to_backlog':
          return this._result(await this._moveTaskToBacklog(args));
        case 'move_task_from_backlog':
          return this._result(await this._moveTaskFromBacklog(args));
        case 'delete_task':
          return await this._requestTaskDeletion(args);
        case 'archive_task':
          return this._result(await this._archiveTask(args));
        case 'restore_task':
          return this._result(await this._restoreTask(args));
        case 'start_tracking':
          return this._result(await this._startTracking(args));
        case 'stop_tracking':
          this._taskService.pauseCurrent();
          return this._result({ ok: true, message: 'Stopped time tracking.' });
        case 'log_time':
          return this._result(await this._logTime(args));
        case 'set_task_reminder':
          return this._result(await this._setTaskReminder(args));
        case 'create_project':
          return this._result(await this._createProject(args));
        case 'update_project':
          return this._result(await this._updateProject(args));
        case 'delete_project':
          return await this._requestProjectDeletion(args);
        case 'create_tag':
          return this._result(await this._createTag(args));
        case 'update_tag':
          return this._result(await this._updateTag(args));
        case 'delete_tag':
          return await this._requestTagDeletion(args);
        case 'create_note':
          return this._result(await this._createNote(args));
        case 'update_note':
          return this._result(await this._updateNote(args));
        case 'delete_note':
          return await this._requestNoteDeletion(args);
        case 'set_task_recurrence':
          return this._result(await this._setTaskRecurrence(args));
        case 'switch_work_context':
          return this._result(await this._switchWorkContext(args));
        default:
          return this._result({ ok: false, error: 'Unknown assistant tool.' });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The requested operation failed.';
      return this._result({ ok: false, error: message });
    }
  }

  async resolvePendingConfirmation(userText: string): Promise<ConfirmationResolution> {
    const pending = this._pendingConfirmation;
    if (!pending) return { status: 'none' };

    const input = userText.trim();
    if (Date.now() > pending.expiresAt) {
      this._pendingConfirmation = undefined;
      return {
        status: 'handled',
        content:
          'The confirmation expired. Nothing was deleted; ask me again if you still want to delete it.',
      };
    }

    if (/^cancel$/i.test(input)) {
      this._pendingConfirmation = undefined;
      return { status: 'handled', content: 'Canceled. Nothing was deleted.' };
    }

    const match = /^confirm\s+([a-z0-9]{6})$/i.exec(input);
    if (match) {
      this._pendingConfirmation = undefined;
      if (match[1].toUpperCase() !== pending.code) {
        return {
          status: 'handled',
          content: 'That confirmation code did not match. Nothing was deleted.',
        };
      }
      try {
        return {
          status: 'handled',
          content: await pending.execute(),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The confirmed operation failed.';
        return { status: 'handled', content: 'The operation failed: ' + message };
      }
    }

    this._pendingConfirmation = undefined;
    return { status: 'continue', code: pending.code };
  }

  private _result(value: unknown): ToolExecution {
    return { content: JSON.stringify(value).slice(0, 24000) };
  }

  private _parseArgs(rawArgs: string): ToolArgs {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      throw new Error('The model supplied invalid tool arguments.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be a JSON object.');
    }
    return parsed as ToolArgs;
  }

  private _requiredString(args: ToolArgs, key: string, maxLength = 500): string {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
      throw new Error('A valid ' + key.replaceAll('_', ' ') + ' is required.');
    }
    return value.trim();
  }

  private _optionalString(
    args: ToolArgs,
    key: string,
    maxLength = 500,
  ): string | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > maxLength) {
      throw new Error(key.replaceAll('_', ' ') + ' must be text.');
    }
    return value.trim();
  }

  private _optionalText(
    args: ToolArgs,
    key: string,
    maxLength: number,
  ): string | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > maxLength) {
      throw new Error(key.replaceAll('_', ' ') + ' must be text.');
    }
    return value;
  }

  private _requiredText(args: ToolArgs, key: string, maxLength: number): string {
    const value = this._optionalText(args, key, maxLength);
    if (value === undefined || !value.trim()) {
      throw new Error('A valid ' + key.replaceAll('_', ' ') + ' is required.');
    }
    return value;
  }

  private _optionalBoolean(args: ToolArgs, key: string): boolean | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean')
      throw new Error(key.replaceAll('_', ' ') + ' must be true or false.');
    return value;
  }

  private _optionalNumber(
    args: ToolArgs,
    key: string,
    min: number,
    max: number,
  ): number | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      throw new Error(key.replaceAll('_', ' ') + ' is outside the supported range.');
    }
    return value;
  }

  private _taskPriority(value: number | undefined): TaskPriority | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || ![1, 2, 3].includes(value)) {
      throw new Error('priority must be 1, 2, or 3.');
    }
    return value as TaskPriority;
  }

  private _requiredArray(args: ToolArgs, key: string): string[] {
    const value = args[key];
    if (
      !Array.isArray(value) ||
      value.length > 50 ||
      value.some((item) => typeof item !== 'string')
    ) {
      throw new Error(key.replaceAll('_', ' ') + ' must be a list of IDs.');
    }
    return [...new Set(value.map((item: string) => item.trim()).filter(Boolean))];
  }

  private _reminderOption(value: unknown): TaskReminderOptionId {
    if (value === undefined) return TaskReminderOptionId.DoNotRemind;
    if (
      typeof value !== 'string' ||
      !Object.values(TaskReminderOptionId).includes(value as TaskReminderOptionId)
    ) {
      throw new Error('reminder is not a supported reminder option.');
    }
    return value as TaskReminderOptionId;
  }

  private _existingReminderOption(task: Task): TaskReminderOptionId {
    if (!task.dueWithTime || typeof task.remindAt !== 'number') {
      return TaskReminderOptionId.DoNotRemind;
    }
    return millisecondsDiffToRemindOption(task.dueWithTime, task.remindAt);
  }

  private _validateDate(value: string, fieldName: string): string {
    if (!isDBDateStr(value)) throw new Error(fieldName + ' must use YYYY-MM-DD.');
    return value;
  }

  private _validateTimestamp(value: string, fieldName: string): number {
    const parsed = Date.parse(value);
    if (!value.includes('T') || !Number.isFinite(parsed)) {
      throw new Error(fieldName + ' must be a valid ISO timestamp.');
    }
    return parsed;
  }

  private async _allTasks(includeArchived = false): Promise<Task[]> {
    const tasks = await firstValueFrom(this._store.select(selectAllTasks));
    if (!includeArchived) return tasks;
    const archived = await this._taskService.getArchivedTasks();
    return [...tasks, ...archived];
  }

  private async _getActiveTask(taskId: string): Promise<Task | undefined> {
    const tasks = await firstValueFrom(this._store.select(selectAllTasks));
    return tasks.find((task) => task.id === taskId);
  }

  private async _getProject(projectId: string): Promise<Project | undefined> {
    const projects = await firstValueFrom(this._store.select(selectAllProjects));
    return projects.find((project) => project.id === projectId);
  }

  private async _getTag(tagId: string): Promise<Tag | undefined> {
    const tags = await firstValueFrom(this._store.select(selectAllTags));
    return tags.find((tag) => tag.id === tagId);
  }

  private async _getNote(noteId: string): Promise<Note | undefined> {
    const notes = await firstValueFrom(this._store.select(selectAllNotes));
    return notes.find((note) => note.id === noteId);
  }

  private _validateTaskTags(ids: string[], tags: Tag[]): string[] {
    const assignable = new Set(
      tags.filter((tag) => tag.id !== TODAY_TAG.id).map((tag) => tag.id),
    );
    const missing = ids.filter((id) => !assignable.has(id));
    if (missing.length)
      throw new Error('One or more tags were not found or cannot be assigned.');
    return ids;
  }

  private _parseTaskDateFields(args: ToolArgs): Partial<Task> {
    const dueDay = this._optionalString(args, 'due_day');
    const dueAt = this._optionalString(args, 'due_at');
    const deadlineDay = this._optionalString(args, 'deadline_day');
    const deadlineAt = this._optionalString(args, 'deadline_at');
    if (dueDay && dueAt) throw new Error('Choose either due_day or due_at, not both.');
    if (deadlineDay && deadlineAt) {
      throw new Error('Choose either deadline_day or deadline_at, not both.');
    }
    return {
      ...(dueDay !== undefined
        ? { dueDay: this._validateDate(dueDay, 'due_day'), dueWithTime: null }
        : {}),
      ...(dueAt !== undefined
        ? { dueWithTime: this._validateTimestamp(dueAt, 'due_at'), dueDay: null }
        : {}),
      ...(deadlineDay !== undefined
        ? {
            deadlineDay: this._validateDate(deadlineDay, 'deadline_day'),
            deadlineWithTime: null,
          }
        : {}),
      ...(deadlineAt !== undefined
        ? {
            deadlineWithTime: this._validateTimestamp(deadlineAt, 'deadline_at'),
            deadlineDay: null,
          }
        : {}),
    };
  }

  private async _createTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const title = this._requiredString(args, 'title', 1000);
    const projectId = this._optionalString(args, 'project_id');
    const tagIds =
      args['tag_ids'] === undefined ? undefined : this._requiredArray(args, 'tag_ids');
    const notes = this._optionalText(args, 'notes', 20000);
    const priority = this._taskPriority(this._optionalNumber(args, 'priority', 1, 3));
    const estimate = this._optionalNumber(args, 'estimate_minutes', 0, MAX_MINUTES);
    const addToBacklog = this._optionalBoolean(args, 'add_to_backlog') ?? false;
    const reminder = this._reminderOption(args['reminder']);
    const [projects, tags] = await Promise.all([
      firstValueFrom(this._store.select(selectAllProjects)),
      firstValueFrom(this._store.select(selectAllTags)),
    ]);
    if (
      projectId &&
      !projects.some((project) => project.id === projectId && !project.isArchived)
    ) {
      throw new Error('The selected active project was not found.');
    }
    const dateFields = this._parseTaskDateFields(args);
    const { dueDay, dueWithTime, ...otherDateFields } = dateFields;
    if ((dueDay !== undefined || dueWithTime !== undefined) && addToBacklog) {
      throw new Error(
        'A task cannot be added to the backlog and planned at the same time.',
      );
    }
    if (dueDay && reminder !== TaskReminderOptionId.DoNotRemind) {
      throw new Error('A due-time reminder requires a timed due_at value.');
    }
    if (
      dueWithTime &&
      (reminder === TaskReminderOptionId.d1 ||
        reminder === TaskReminderOptionId.d3 ||
        reminder === TaskReminderOptionId.w1)
    ) {
      throw new Error('Due-time reminders support up to one hour in advance.');
    }
    const fields: Partial<Task> = {
      ...otherDateFields,
      ...(projectId ? { projectId } : {}),
      ...(tagIds ? { tagIds: this._validateTaskTags(tagIds, tags) } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(estimate !== undefined ? { timeEstimate: Math.round(estimate * 60000) } : {}),
    };
    const id = this._taskService.add(title, addToBacklog, fields, true, true);
    if (dueDay) {
      const date = dueDay;
      if (date === this._dateService.todayStr()) {
        this._taskService.scheduleForTodayById(id);
      } else {
        const task = await this._getActiveTask(id);
        if (task)
          this._store.dispatch(PlannerActions.planTaskForDay({ task, day: date }));
      }
    } else if (dueWithTime) {
      const task = await this._getActiveTask(id);
      if (task) this._taskService.scheduleTask(task, dueWithTime, reminder);
    }
    return { ok: true, task_id: id, title };
  }

  private async _createSubtask(args: ToolArgs): Promise<Record<string, unknown>> {
    const parentId = this._requiredString(args, 'parent_task_id');
    const title = this._requiredString(args, 'title', 1000);
    const parent = await this._getActiveTask(parentId);
    if (!parent) throw new Error('Parent task not found in active tasks.');
    const notes = this._optionalText(args, 'notes', 20000);
    const estimate = this._optionalNumber(args, 'estimate_minutes', 0, MAX_MINUTES);
    const priority = this._taskPriority(this._optionalNumber(args, 'priority', 1, 3));
    const id = this._taskService.addSubTaskTo(parentId, {
      title,
      projectId: parent.projectId,
      ...(notes !== undefined ? { notes } : {}),
      ...(estimate !== undefined ? { timeEstimate: Math.round(estimate * 60000) } : {}),
      ...(priority !== undefined ? { priority } : {}),
    });
    return { ok: true, task_id: id, parent_task_id: parentId, title };
  }

  private async _updateTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    const title =
      args['title'] === undefined ? undefined : this._requiredString(args, 'title', 1000);
    const notes = this._optionalText(args, 'notes', 20000);
    const priority = args['priority'];
    const estimate = this._optionalNumber(args, 'estimate_minutes', 0, MAX_MINUTES);
    const projectId = this._optionalString(args, 'project_id');
    const clearDeadline = this._optionalBoolean(args, 'clear_deadline') ?? false;
    const dateFields = this._parseTaskDateFields(args);
    if (dateFields.dueDay !== undefined || dateFields.dueWithTime !== undefined) {
      throw new Error("Use plan_task to change or clear a task's schedule.");
    }
    const deadlineDay =
      typeof dateFields.deadlineDay === 'string' ? dateFields.deadlineDay : undefined;
    const deadlineWithTime =
      typeof dateFields.deadlineWithTime === 'number'
        ? dateFields.deadlineWithTime
        : undefined;
    if (clearDeadline && (deadlineDay !== undefined || deadlineWithTime !== undefined)) {
      throw new Error('Do not combine clear_deadline with a new deadline.');
    }
    if (priority !== undefined) {
      if (
        priority !== null &&
        (typeof priority !== 'number' || ![1, 2, 3].includes(priority))
      ) {
        throw new Error('priority must be 1, 2, 3, or null.');
      }
    }
    const changes: Partial<Task> = {
      ...(title !== undefined ? { title } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(priority !== undefined ? { priority: priority as TaskPriority | null } : {}),
      ...(estimate !== undefined ? { timeEstimate: Math.round(estimate * 60000) } : {}),
    };
    if (projectId !== undefined) {
      const projects = await firstValueFrom(this._store.select(selectAllProjects));
      if (!projects.some((project) => project.id === projectId && !project.isArchived)) {
        throw new Error('The selected active project was not found.');
      }
      Object.assign(changes, { projectId });
    }
    let deadlineChanged = false;
    if (clearDeadline) {
      this._store.dispatch(TaskSharedActions.removeDeadline({ taskId: id }));
      deadlineChanged = true;
    } else if (deadlineDay !== undefined || deadlineWithTime !== undefined) {
      this._store.dispatch(
        TaskSharedActions.setDeadline({
          taskId: id,
          ...(deadlineDay !== undefined ? { deadlineDay } : {}),
          ...(deadlineWithTime !== undefined ? { deadlineWithTime } : {}),
        }),
      );
      deadlineChanged = true;
    }
    if (!Object.keys(changes).length && !deadlineChanged)
      throw new Error('No supported task changes were provided.');
    if (Object.keys(changes).length) this._taskService.update(id, changes);
    return {
      ok: true,
      task_id: id,
      updated_fields: [...Object.keys(changes), ...(deadlineChanged ? ['deadline'] : [])],
    };
  }

  private async _setTaskCompletion(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const isDone = this._optionalBoolean(args, 'is_done');
    if (isDone === undefined) throw new Error('is_done is required.');
    if (!(await this._getActiveTask(id)))
      throw new Error('Task not found in active tasks.');
    if (isDone) this._taskService.setDone(id);
    else this._taskService.setUnDone(id);
    return { ok: true, task_id: id, is_done: isDone };
  }

  private async _reorderTodayTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const direction = this._requiredString(args, 'direction');
    if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
      throw new Error('direction must be up, down, top, or bottom.');
    }
    const [todayTaskIds, tasks] = await Promise.all([
      firstValueFrom(this._store.select(selectTodayTaskIds)),
      firstValueFrom(this._store.select(selectAllTasks)),
    ]);
    const taskById = new Map(tasks.map((candidate) => [candidate.id, candidate]));
    const task = taskById.get(id);
    if (!task) throw new Error('Task not found in active tasks.');
    if (!todayTaskIds.includes(id)) throw new Error('Task is not in today’s plan.');
    if (task.isDone) throw new Error('Completed tasks cannot be reordered.');

    const openTaskIds = todayTaskIds.filter((taskId) => !taskById.get(taskId)?.isDone);
    const openIndex = openTaskIds.indexOf(id);
    const isAlreadyAtEdge =
      ((direction === 'up' || direction === 'top') && openIndex === 0) ||
      ((direction === 'down' || direction === 'bottom') &&
        openIndex === openTaskIds.length - 1);
    if (isAlreadyAtEdge) {
      return { ok: true, task_id: id, direction, unchanged: true };
    }

    const actionByDirection = {
      up: moveTaskUpInTodayList,
      down: moveTaskDownInTodayList,
      top: moveTaskToTopInTodayList,
      bottom: moveTaskToBottomInTodayList,
    } as const;
    this._store.dispatch(
      actionByDirection[direction as keyof typeof actionByDirection]({
        taskId: id,
        workContextType: WorkContextType.TAG,
        workContextId: TODAY_TAG.id,
        doneTaskIds: openTaskIds,
      }),
    );
    return { ok: true, task_id: id, direction };
  }

  private async _planTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    const dueDay = args['due_day'];
    const dueAt = args['due_at'];
    if (dueDay !== null && dueDay !== undefined && typeof dueDay !== 'string') {
      throw new Error('due_day must be an ISO date or null.');
    }
    if (dueAt !== null && dueAt !== undefined && typeof dueAt !== 'string') {
      throw new Error('due_at must be an ISO timestamp or null.');
    }
    if (dueDay && dueAt) throw new Error('Choose either due_day or due_at, not both.');
    if (dueDay === null && dueAt === null) {
      this._store.dispatch(TaskSharedActions.unscheduleTask({ id }));
      return { ok: true, task_id: id, planned_for: null };
    }
    if (dueDay) {
      const date = this._validateDate(dueDay, 'due_day');
      if (date === this._dateService.todayStr()) {
        this._taskService.scheduleForTodayById(id);
      } else {
        this._store.dispatch(PlannerActions.planTaskForDay({ task, day: date }));
      }
      return { ok: true, task_id: id, planned_for: date };
    }
    if (dueAt) {
      const timestamp = this._validateTimestamp(dueAt, 'due_at');
      const reminder =
        args['reminder'] === undefined
          ? this._existingReminderOption(task)
          : this._reminderOption(args['reminder']);
      if (
        reminder === TaskReminderOptionId.d1 ||
        reminder === TaskReminderOptionId.d3 ||
        reminder === TaskReminderOptionId.w1
      ) {
        throw new Error('Due-time reminders support up to one hour in advance.');
      }
      this._taskService.scheduleTask(task, timestamp, reminder);
      return { ok: true, task_id: id, planned_at: new Date(timestamp).toISOString() };
    }
    throw new Error('Provide due_day or due_at, or set both to null to remove the plan.');
  }

  private async _setTaskTags(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    const ids = this._requiredArray(args, 'tag_ids');
    const tags = await firstValueFrom(this._store.select(selectAllTags));
    this._taskService.updateTags(task, this._validateTaskTags(ids, tags));
    return { ok: true, task_id: id, tag_ids: ids };
  }

  private async _moveTaskToBacklog(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    if (task.parentId) throw new Error('Move the parent task to the backlog instead.');
    const project = await this._getProject(task.projectId);
    if (!project || !project.isEnableBacklog) {
      throw new Error('This task’s project does not have its backlog enabled.');
    }
    this._projectService.moveTaskToBacklog(id, project.id);
    return { ok: true, task_id: id, project_id: project.id, location: 'backlog' };
  }

  private async _moveTaskFromBacklog(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    if (task.parentId) throw new Error('Move the parent task from the backlog instead.');
    const project = await this._getProject(task.projectId);
    if (!project || !project.isEnableBacklog) {
      throw new Error('This task’s project does not have its backlog enabled.');
    }
    this._projectService.moveTaskToTodayList(id, project.id);
    return { ok: true, task_id: id, project_id: project.id, location: 'active_list' };
  }

  private _confirmationCode(): string {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 6)
      .toUpperCase();
  }

  private _requestConfirmation(
    description: string,
    execute: () => Promise<string>,
  ): ToolExecution {
    const code = this._confirmationCode();
    const prompt =
      'To ' +
      description +
      ', type CONFIRM ' +
      code +
      ' in your next chat message. Type cancel to stop. This code expires in 5 minutes.';
    this._pendingConfirmation = {
      code,
      expiresAt: Date.now() + CONFIRMATION_TTL_MS,
      execute,
    };
    return { content: prompt, needsConfirmation: true };
  }

  private async _requestTaskDeletion(args: ToolArgs): Promise<ToolExecution> {
    const id = this._requiredString(args, 'task_id');
    const task = await firstValueFrom(this._taskService.getByIdWithSubTaskData$(id));
    if (!task) throw new Error('Task not found in active tasks.');
    const title = task.title;
    const subtaskCount = task.subTaskIds.length;
    const description =
      'permanently delete task "' +
      title +
      '"' +
      (subtaskCount ? ' and its ' + subtaskCount + ' subtasks' : '');
    return this._requestConfirmation(description, async () => {
      const current = await firstValueFrom(this._taskService.getByIdWithSubTaskData$(id));
      if (!current) throw new Error('Task no longer exists.');
      this._taskService.remove(current);
      return 'Deleted task "' + title + '".';
    });
  }

  private async _archiveTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await firstValueFrom(this._taskService.getByIdWithSubTaskData$(id));
    if (!task) throw new Error('Task not found in active tasks.');
    if (task.parentId)
      throw new Error('Archive the parent task to archive this subtask.');
    await this._taskService.moveToArchive(task);
    return { ok: true, task_id: id, archived: true };
  }

  private async _restoreTask(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const archived = await this._taskService.getArchivedTasks();
    const task = archived.find((candidate) => candidate.id === id);
    if (!task) throw new Error('Archived task not found.');
    if (task.parentId)
      throw new Error('Restore the parent task to restore this subtask.');
    const subtaskIds = new Set(task.subTaskIds);
    const subtasks = archived.filter((candidate) => subtaskIds.has(candidate.id));
    this._taskService.restoreTask(task, subtasks);
    return { ok: true, task_id: id, restored_subtask_count: subtasks.length };
  }

  private async _startTracking(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    if (task.isDone) throw new Error('Reopen the task before starting its timer.');
    this._taskService.setCurrentId(id);
    return { ok: true, task_id: id, tracking: true };
  }

  private async _logTime(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const minutes = this._optionalNumber(args, 'minutes', 1, MAX_MINUTES);
    if (minutes === undefined) throw new Error('minutes is required.');
    const date = this._validateDate(
      this._optionalString(args, 'date') ?? this._dateService.todayStr(),
      'date',
    );
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    this._taskService.addTimeSpentAndSync(task, Math.round(minutes * 60000), date);
    return { ok: true, task_id: id, minutes, date };
  }

  private async _setTaskReminder(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    const kind = this._requiredString(args, 'kind');
    const reminder = this._reminderOption(args['reminder']);
    if (kind === 'due') {
      if (
        reminder === TaskReminderOptionId.d1 ||
        reminder === TaskReminderOptionId.d3 ||
        reminder === TaskReminderOptionId.w1
      ) {
        throw new Error('Due-time reminders support up to one hour in advance.');
      }
      if (reminder === TaskReminderOptionId.DoNotRemind) {
        this._store.dispatch(TaskSharedActions.dismissReminderOnly({ id }));
        return { ok: true, task_id: id, kind, reminder };
      }
      if (!task.dueWithTime) throw new Error('This task does not have a timed due date.');
      this._taskService.scheduleTask(task, task.dueWithTime, reminder);
      return { ok: true, task_id: id, kind, reminder };
    }
    if (kind === 'deadline') {
      if (reminder === TaskReminderOptionId.DoNotRemind) {
        this._store.dispatch(TaskSharedActions.clearDeadlineReminder({ taskId: id }));
        return { ok: true, task_id: id, kind, reminder };
      }
      if (!task.deadlineWithTime) {
        throw new Error('This task does not have a timed deadline.');
      }
      const deadlineRemindAt = remindOptionToMilliseconds(
        task.deadlineWithTime,
        reminder,
      );
      if (deadlineRemindAt === undefined) {
        throw new Error('Could not calculate the deadline reminder.');
      }
      this._store.dispatch(
        TaskSharedActions.setDeadline({
          taskId: id,
          deadlineWithTime: task.deadlineWithTime,
          deadlineRemindAt,
        }),
      );
      return { ok: true, task_id: id, kind, reminder };
    }
    throw new Error('kind must be due or deadline.');
  }

  private async _createProject(args: ToolArgs): Promise<Record<string, unknown>> {
    const title = this._requiredString(args, 'title', 200);
    const enableBacklog = this._optionalBoolean(args, 'enable_backlog') ?? false;
    const id = this._projectService.add({ title, isEnableBacklog: enableBacklog });
    return { ok: true, project_id: id, title };
  }

  private async _updateProject(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'project_id');
    const project = await this._getProject(id);
    if (!project) throw new Error('Project not found.');
    const title =
      args['title'] === undefined ? undefined : this._requiredString(args, 'title', 200);
    const enableBacklog = this._optionalBoolean(args, 'enable_backlog');
    const isArchived = this._optionalBoolean(args, 'is_archived');
    if (isArchived === false) {
      await this._projectService.unarchive(id);
      if (title !== undefined || enableBacklog !== undefined) {
        this._projectService.update(id, {
          ...(title !== undefined ? { title } : {}),
          ...(enableBacklog !== undefined ? { isEnableBacklog: enableBacklog } : {}),
        });
      }
      return { ok: true, project_id: id, is_archived: false };
    }
    const changes: Partial<Project> = {
      ...(title !== undefined ? { title } : {}),
      ...(enableBacklog !== undefined ? { isEnableBacklog: enableBacklog } : {}),
      ...(isArchived === true ? { isArchived: true } : {}),
    };
    if (!Object.keys(changes).length)
      throw new Error('No supported project changes were provided.');
    this._projectService.update(id, changes);
    return { ok: true, project_id: id, updated_fields: Object.keys(changes) };
  }

  private async _requestProjectDeletion(args: ToolArgs): Promise<ToolExecution> {
    const id = this._requiredString(args, 'project_id');
    const project = await this._getProject(id);
    if (!project) throw new Error('Project not found.');
    const title = project.title;
    const tasks = await this._allTasks();
    const taskCount = tasks.filter((task) => task.projectId === id).length;
    const noteCount = project.noteIds.length;
    return this._requestConfirmation(
      'permanently delete project "' +
        title +
        '" and its ' +
        taskCount +
        ' tasks and ' +
        noteCount +
        ' notes',
      async () => {
        const current = await this._getProject(id);
        if (!current) throw new Error('Project no longer exists.');
        await this._projectService.remove(current);
        return 'Deleted project "' + title + '" and its tasks and notes.';
      },
    );
  }

  private _safeColor(value: string): string {
    if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
      throw new Error('Colors must be a 6- or 8-digit hex value such as #5588AA.');
    }
    return value;
  }

  private async _createTag(args: ToolArgs): Promise<Record<string, unknown>> {
    const title = this._requiredString(args, 'title', 100);
    const color = this._optionalString(args, 'color', 9);
    const id = this._tagService.addTag({
      title,
      ...(color ? { color: this._safeColor(color) } : {}),
    });
    return { ok: true, tag_id: id, title };
  }

  private async _updateTag(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'tag_id');
    const tag = await this._getTag(id);
    if (!tag || id === TODAY_TAG.id) throw new Error('User tag not found.');
    const title =
      args['title'] === undefined ? undefined : this._requiredString(args, 'title', 100);
    const color = this._optionalString(args, 'color', 9);
    const changes: Partial<Tag> = {
      ...(title !== undefined ? { title } : {}),
      ...(color !== undefined ? { color: this._safeColor(color) } : {}),
    };
    if (!Object.keys(changes).length)
      throw new Error('No supported tag changes were provided.');
    this._tagService.updateTag(id, changes);
    return { ok: true, tag_id: id, updated_fields: Object.keys(changes) };
  }

  private async _requestTagDeletion(args: ToolArgs): Promise<ToolExecution> {
    const id = this._requiredString(args, 'tag_id');
    const tag = await this._getTag(id);
    if (!tag || id === TODAY_TAG.id) throw new Error('User tag not found.');
    const title = tag.title;
    return this._requestConfirmation(
      'delete tag "' + title + '" and remove its task assignments',
      async () => {
        if (!(await this._getTag(id))) throw new Error('Tag no longer exists.');
        this._tagService.deleteTag(id);
        return 'Deleted tag "' + title + '".';
      },
    );
  }

  private async _createNote(args: ToolArgs): Promise<Record<string, unknown>> {
    const content = this._requiredText(args, 'content', 20000);
    const projectId = this._optionalString(args, 'project_id');
    const pinToToday = this._optionalBoolean(args, 'pin_to_today') ?? false;
    if (projectId) {
      const project = await this._getProject(projectId);
      if (!project || project.isArchived) throw new Error('Active project not found.');
    }
    const id = nanoid();
    this._noteService.add(
      {
        id,
        projectId: projectId ?? null,
        isPinnedToToday: pinToToday,
        content,
      },
      true,
    );
    return { ok: true, note_id: id };
  }

  private async _updateNote(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'note_id');
    const note = await this._getNote(id);
    if (!note) throw new Error('Note not found.');
    const content = this._optionalText(args, 'content', 20000);
    const projectId = this._optionalString(args, 'project_id');
    if (content === undefined && projectId === undefined) {
      throw new Error('Provide note content or a target project.');
    }
    if (projectId) {
      const project = await this._getProject(projectId);
      if (!project || project.isArchived) throw new Error('Active project not found.');
      if (note.projectId !== projectId) {
        this._noteService.moveToOtherProject(note, projectId);
      }
    }
    if (content !== undefined) {
      this._noteService.update(id, { content, modified: Date.now() });
    }
    return {
      ok: true,
      note_id: id,
      ...(content !== undefined ? { content_updated: true } : {}),
      ...(projectId ? { project_id: projectId } : {}),
    };
  }

  private async _requestNoteDeletion(args: ToolArgs): Promise<ToolExecution> {
    const id = this._requiredString(args, 'note_id');
    const note = await this._getNote(id);
    if (!note) throw new Error('Note not found.');
    return this._requestConfirmation('permanently delete this note', async () => {
      const current = await this._getNote(id);
      if (!current) throw new Error('Note no longer exists.');
      this._noteService.remove(current);
      return 'Deleted the note.';
    });
  }

  private async _setTaskRecurrence(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const task = await this._getActiveTask(id);
    if (!task) throw new Error('Task not found in active tasks.');
    const cycle = this._requiredString(args, 'cycle') as RepeatCycleOption;
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(cycle)) {
      throw new Error('cycle must be DAILY, WEEKLY, MONTHLY, or YEARLY.');
    }
    const every = Math.round(this._optionalNumber(args, 'every', 1, 365) ?? 1);
    const repeatUntil = args['repeat_until'];
    if (
      repeatUntil !== undefined &&
      repeatUntil !== null &&
      typeof repeatUntil !== 'string'
    ) {
      throw new Error('repeat_until must be an ISO date or null.');
    }
    const repeatUntilDay =
      typeof repeatUntil === 'string'
        ? this._validateDate(repeatUntil, 'repeat_until')
        : undefined;
    const requestedPaused = this._optionalBoolean(args, 'paused');
    const weekdaysRaw = args['weekdays'];
    if (
      weekdaysRaw !== undefined &&
      (!Array.isArray(weekdaysRaw) ||
        weekdaysRaw.some(
          (day) =>
            typeof day !== 'string' ||
            !(TASK_REPEAT_WEEKDAY_MAP as readonly string[]).includes(day),
        ))
    ) {
      throw new Error('weekdays must contain lowercase weekday names.');
    }
    const configs = await firstValueFrom(this._store.select(selectAllTaskRepeatCfgs));
    const current = task.repeatCfgId
      ? configs.find((config) => config.id === task.repeatCfgId)
      : undefined;
    const paused = requestedPaused ?? current?.isPaused ?? false;
    const weekdays =
      (weekdaysRaw as (typeof TASK_REPEAT_WEEKDAY_MAP)[number][] | undefined) ??
      (current && cycle === 'WEEKLY'
        ? TASK_REPEAT_WEEKDAY_MAP.filter((day) => current[day])
        : cycle === 'WEEKLY'
          ? [
              WEEKDAY_BY_INDEX[
                new Date(this._dateService.todayStr() + 'T12:00:00').getDay()
              ],
            ]
          : [...TASK_REPEAT_WEEKDAY_MAP]);
    const quickSetting: RepeatQuickSetting =
      cycle === 'DAILY' && every === 1 ? 'DAILY' : 'CUSTOM';
    if (current) {
      const changes: Partial<TaskRepeatCfg> = {
        repeatCycle: cycle,
        repeatEvery: every,
        quickSetting,
        isPaused: paused,
        ...Object.fromEntries(
          TASK_REPEAT_WEEKDAY_MAP.map((day) => [day, weekdays.includes(day)]),
        ),
        ...(repeatUntilDay ? { repeatUntilDay } : {}),
      };
      if (repeatUntil === null) Object.assign(changes, { repeatUntilDay: null });
      this._repeatService.updateTaskRepeatCfg(current.id, changes);
      return { ok: true, task_id: id, recurrence_id: current.id, updated: true };
    }
    const config = {
      ...DEFAULT_TASK_REPEAT_CFG,
      title: task.title,
      projectId: task.projectId,
      tagIds: [...task.tagIds],
      repeatCycle: cycle,
      repeatEvery: every,
      quickSetting,
      isPaused: paused,
      startDate: this._dateService.todayStr(),
      ...(repeatUntilDay ? { repeatUntilDay } : {}),
      ...Object.fromEntries(
        TASK_REPEAT_WEEKDAY_MAP.map((day) => [day, weekdays.includes(day)]),
      ),
    };
    const recurrenceId = this._repeatService.addTaskRepeatCfgToTask(
      id,
      task.projectId,
      config,
    );
    return { ok: true, task_id: id, recurrence_id: recurrenceId, updated: false };
  }

  private async _switchWorkContext(args: ToolArgs): Promise<Record<string, unknown>> {
    const type = this._requiredString(args, 'type');
    const contextId = this._optionalString(args, 'context_id');
    if (type === 'today') {
      await this._router.navigate(['/tag', TODAY_TAG.id]);
      return { ok: true, context: 'today' };
    }
    if (!contextId) throw new Error('context_id is required.');
    if (type === 'project') {
      const project = await this._getProject(contextId);
      if (!project || project.isArchived) throw new Error('Active project not found.');
      await this._router.navigate(['/project', contextId]);
      return { ok: true, context: 'project', context_id: contextId };
    }
    if (type === 'tag') {
      if (!(await this._getTag(contextId))) throw new Error('Tag not found.');
      await this._router.navigate(['/tag', contextId]);
      return { ok: true, context: 'tag', context_id: contextId };
    }
    throw new Error('type must be project, tag, or today.');
  }
}
