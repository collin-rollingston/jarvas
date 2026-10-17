import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import { selectTodayStr } from '../../root-store/app-state/app-state.selectors';
import { selectAllNotes } from '../note/store/note.reducer';
import { Project } from '../project/project.model';
import { selectAllProjects } from '../project/store/project.selectors';
import { Tag } from '../tag/tag.model';
import { TODAY_TAG } from '../tag/tag.const';
import { selectAllTags } from '../tag/store/tag.reducer';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { selectTodayTaskIds } from '../work-context/store/work-context.selectors';
import { selectAllTaskRepeatCfgs } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import { TaskRepeatCfg } from '../task-repeat-cfg/task-repeat-cfg.model';
import { isDBDateStr } from '../../util/get-db-date-str';

type ToolArgs = Record<string, unknown>;

const MAX_SEARCH_RESULTS = 40;

@Injectable({ providedIn: 'root' })
export class AssistantChatToolReadService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _dateService = inject(DateService);

  async execute(name: string, args: ToolArgs): Promise<unknown> {
    switch (name) {
      case 'search_tasks':
        return this._searchTasks(args);
      case 'get_task_details':
        return this._getTaskDetails(args);
      case 'get_today_plan':
        return this._getTodayPlan();
      case 'get_time_summary':
        return this._getTimeSummary(args);
      case 'list_projects':
        return this._listProjects(args);
      case 'list_tags':
        return this._listTags();
      case 'list_notes':
        return this._listNotes(args);
      case 'list_recurrences':
        return this._listRecurrences(args);
      default:
        throw new Error('Unknown read tool.');
    }
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

  private _optionalBoolean(args: ToolArgs, key: string): boolean | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
      throw new Error(key.replaceAll('_', ' ') + ' must be true or false.');
    }
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
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new Error(key.replaceAll('_', ' ') + ' is outside the supported range.');
    }
    return value;
  }

  private _requiredString(args: ToolArgs, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 500) {
      throw new Error('A valid ' + key.replaceAll('_', ' ') + ' is required.');
    }
    return value.trim();
  }

  private _validateDate(value: string, fieldName: string): string {
    if (!isDBDateStr(value)) throw new Error(fieldName + ' must use YYYY-MM-DD.');
    return value;
  }

  private _localDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  private _taskDueDay(task: Task): string | undefined {
    if (task.dueDay) return task.dueDay;
    return task.dueWithTime ? this._localDate(task.dueWithTime) : undefined;
  }

  private async _allTasks(includeArchived = false): Promise<Task[]> {
    const tasks = await firstValueFrom(this._store.select(selectAllTasks));
    if (!includeArchived) return tasks;
    const archived = await this._taskService.getArchivedTasks();
    return [...tasks, ...archived];
  }

  private _taskSummary(
    task: Task,
    projects: Map<string, Project>,
    tags: Map<string, Tag>,
    includeNotes = false,
    isArchived = false,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: task.id,
      title: task.title,
      is_done: task.isDone,
      project_id: task.projectId,
      project: projects.get(task.projectId)?.title ?? null,
      tag_ids: task.tagIds,
      tags: task.tagIds.map((id) => tags.get(id)?.title).filter(Boolean),
      priority: task.priority ?? null,
      estimate_minutes: Math.round(task.timeEstimate / 60000),
      time_spent_minutes: Math.round(task.timeSpent / 60000),
      due_day: task.dueDay ?? null,
      due_at: task.dueWithTime ? new Date(task.dueWithTime).toISOString() : null,
      deadline_day: task.deadlineDay ?? null,
      deadline_at: task.deadlineWithTime
        ? new Date(task.deadlineWithTime).toISOString()
        : null,
      parent_id: task.parentId ?? null,
      subtask_ids: task.subTaskIds,
      is_archived: isArchived,
    };
    if (includeNotes && task.notes) result['notes'] = task.notes.slice(0, 5000);
    return result;
  }

  private async _searchTasks(args: ToolArgs): Promise<Record<string, unknown>> {
    const query = (this._optionalString(args, 'query', 300) ?? '').toLocaleLowerCase();
    const status = this._optionalString(args, 'status') ?? 'open';
    const projectId = this._optionalString(args, 'project_id');
    const tagId = this._optionalString(args, 'tag_id');
    const plannedFor = this._optionalString(args, 'planned_for');
    const dueFrom = this._optionalString(args, 'due_from');
    const dueTo = this._optionalString(args, 'due_to');
    const includeArchived = this._optionalBoolean(args, 'include_archived') ?? false;
    const includeNotes = this._optionalBoolean(args, 'include_notes') ?? false;
    const limit = this._optionalNumber(args, 'limit', 1, MAX_SEARCH_RESULTS) ?? 20;
    if (status !== 'open' && status !== 'done' && status !== 'all') {
      throw new Error('status must be open, done, or all.');
    }
    if (
      plannedFor !== undefined &&
      !['today', 'backlog', 'upcoming', 'overdue'].includes(plannedFor)
    ) {
      throw new Error('planned_for must be today, backlog, upcoming, or overdue.');
    }
    if (dueFrom) this._validateDate(dueFrom, 'due_from');
    if (dueTo) this._validateDate(dueTo, 'due_to');
    if (dueFrom && dueTo && dueFrom > dueTo) {
      throw new Error('due_from must not be after due_to.');
    }

    const [tasks, projects, tags, today] = await Promise.all([
      this._allTasks(includeArchived),
      firstValueFrom(this._store.select(selectAllProjects)),
      firstValueFrom(this._store.select(selectAllTags)),
      firstValueFrom(this._store.select(selectTodayStr)),
    ]);
    const archivedIds = new Set(
      includeArchived
        ? (await this._taskService.getArchivedTasks()).map((task) => task.id)
        : [],
    );
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    const archivedProjectIds = new Set(
      projects.filter((project) => project.isArchived).map((project) => project.id),
    );
    const matched = tasks.filter((task) => {
      if (!includeArchived && archivedProjectIds.has(task.projectId)) return false;
      if (status === 'open' && task.isDone) return false;
      if (status === 'done' && !task.isDone) return false;
      if (projectId && task.projectId !== projectId) return false;
      if (tagId && !task.tagIds.includes(tagId)) return false;
      const dueDay = this._taskDueDay(task);
      if (plannedFor === 'today' && dueDay !== today) return false;
      if (plannedFor === 'backlog' && (task.isDone || dueDay)) return false;
      if (plannedFor === 'upcoming' && (!dueDay || dueDay <= today || task.isDone)) {
        return false;
      }
      if (plannedFor === 'overdue' && (!dueDay || dueDay >= today || task.isDone)) {
        return false;
      }
      if (dueFrom && (!dueDay || dueDay < dueFrom)) return false;
      if (dueTo && (!dueDay || dueDay > dueTo)) return false;
      if (query) {
        const relatedNames = [
          task.title,
          projectsById.get(task.projectId)?.title ?? '',
          ...task.tagIds.map((id) => tagsById.get(id)?.title ?? ''),
          ...(includeNotes ? [task.notes ?? ''] : []),
        ];
        if (!relatedNames.some((value) => value.toLocaleLowerCase().includes(query))) {
          return false;
        }
      }
      return true;
    });
    matched.sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      return (this._taskDueDay(a) ?? '9999').localeCompare(this._taskDueDay(b) ?? '9999');
    });
    return {
      count: matched.length,
      tasks: matched
        .slice(0, limit)
        .map((task) =>
          this._taskSummary(
            task,
            projectsById,
            tagsById,
            includeNotes,
            archivedIds.has(task.id),
          ),
        ),
    };
  }

  private async _getTaskDetails(args: ToolArgs): Promise<Record<string, unknown>> {
    const id = this._requiredString(args, 'task_id');
    const includeNotes = this._optionalBoolean(args, 'include_notes') ?? false;
    const [tasks, projects, tags] = await Promise.all([
      this._allTasks(true),
      firstValueFrom(this._store.select(selectAllProjects)),
      firstValueFrom(this._store.select(selectAllTags)),
    ]);
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error('Task not found.');
    const taskIds = new Set(task.subTaskIds);
    const subtasks = tasks
      .filter((candidate) => taskIds.has(candidate.id))
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        is_done: candidate.isDone,
      }));
    const archivedIds = new Set(
      (await this._taskService.getArchivedTasks()).map((item) => item.id),
    );
    return {
      ...this._taskSummary(
        task,
        new Map(projects.map((project) => [project.id, project])),
        new Map(tags.map((tag) => [tag.id, tag])),
        includeNotes,
        archivedIds.has(task.id),
      ),
      subtasks,
      created: task.created,
      done_on: task.doneOn ?? null,
      time_by_day_minutes: Object.fromEntries(
        Object.entries(task.timeSpentOnDay ?? {}).map(([day, milliseconds]) => [
          day,
          Math.round(milliseconds / 60000),
        ]),
      ),
    };
  }

  private async _getTodayPlan(): Promise<Record<string, unknown>> {
    const [ids, tasks, projects, tags, today] = await Promise.all([
      firstValueFrom(this._store.select(selectTodayTaskIds)),
      firstValueFrom(this._store.select(selectAllTasks)),
      firstValueFrom(this._store.select(selectAllProjects)),
      firstValueFrom(this._store.select(selectAllTags)),
      firstValueFrom(this._store.select(selectTodayStr)),
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
    return {
      date: today,
      tasks: ids
        .map((id) => taskById.get(id))
        .filter((task): task is Task => !!task)
        .map((task) => this._taskSummary(task, projectsById, tagsById)),
    };
  }

  private async _getTimeSummary(args: ToolArgs): Promise<Record<string, unknown>> {
    const from = this._validateDate(
      this._optionalString(args, 'from') ?? this._dateService.todayStr(),
      'from',
    );
    const to = this._validateDate(
      this._optionalString(args, 'to') ?? this._dateService.todayStr(),
      'to',
    );
    const projectId = this._optionalString(args, 'project_id');
    const taskId = this._optionalString(args, 'task_id');
    if (from > to) throw new Error('from must not be after to.');
    const rangeStart = Date.parse(from + 'T00:00:00Z');
    const rangeEnd = Date.parse(to + 'T00:00:00Z');
    if ((rangeEnd - rangeStart) / 86400000 > 366) {
      throw new Error('Time summaries are limited to 367 calendar days.');
    }
    const [tasks, projects] = await Promise.all([
      this._allTasks(true),
      firstValueFrom(this._store.select(selectAllProjects)),
    ]);
    if (projectId && !projects.some((project) => project.id === projectId)) {
      throw new Error('Project not found.');
    }
    const matched = tasks.filter(
      (task) =>
        (!projectId || task.projectId === projectId) && (!taskId || task.id === taskId),
    );
    const allTaskSummaries = matched
      .map((task) => {
        const days = Object.entries(task.timeSpentOnDay ?? {}).filter(
          ([date]) => date >= from && date <= to,
        );
        const milliseconds = days.reduce((total, [, spent]) => total + spent, 0);
        return {
          task_id: task.id,
          title: task.title,
          project_id: task.projectId,
          minutes: Math.round(milliseconds / 60000),
          by_day: Object.fromEntries(
            days.map(([date, spent]) => [date, Math.round(spent / 60000)]),
          ),
        };
      })
      .filter((entry) => entry.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes);
    return {
      from,
      to,
      total_minutes: allTaskSummaries.reduce((total, item) => total + item.minutes, 0),
      tasks: allTaskSummaries.slice(0, 100),
    };
  }

  private async _listProjects(args: ToolArgs): Promise<Record<string, unknown>> {
    const includeArchived = this._optionalBoolean(args, 'include_archived') ?? true;
    const projects = await firstValueFrom(this._store.select(selectAllProjects));
    return {
      projects: projects
        .filter((project) => includeArchived || !project.isArchived)
        .map((project) => ({
          id: project.id,
          title: project.title,
          is_archived: !!project.isArchived,
          is_done: !!project.isDone,
          backlog_enabled: !!project.isEnableBacklog,
          task_count: project.taskIds.length + project.backlogTaskIds.length,
          note_count: project.noteIds.length,
        })),
    };
  }

  private async _listTags(): Promise<Record<string, unknown>> {
    const tags = await firstValueFrom(this._store.select(selectAllTags));
    return {
      tags: tags.map((tag) => ({
        id: tag.id,
        title: tag.title,
        color: tag.color ?? null,
        is_virtual_today: tag.id === TODAY_TAG.id,
      })),
    };
  }

  private async _listNotes(args: ToolArgs): Promise<Record<string, unknown>> {
    const projectId = this._optionalString(args, 'project_id');
    const includeToday = this._optionalBoolean(args, 'include_today') ?? true;
    const includeContent = this._optionalBoolean(args, 'include_content') ?? false;
    const limit = this._optionalNumber(args, 'limit', 1, 20) ?? 10;
    const [notes, projects] = await Promise.all([
      firstValueFrom(this._store.select(selectAllNotes)),
      firstValueFrom(this._store.select(selectAllProjects)),
    ]);
    if (projectId && !projects.some((project) => project.id === projectId)) {
      throw new Error('Project not found.');
    }
    const matched = notes
      .filter(
        (note) =>
          (!projectId || note.projectId === projectId) &&
          (includeToday || !note.isPinnedToToday),
      )
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit);
    return {
      count: matched.length,
      notes: matched.map((note) => ({
        id: note.id,
        project_id: note.projectId,
        project: projects.find((project) => project.id === note.projectId)?.title ?? null,
        pinned_to_today: note.isPinnedToToday,
        modified: note.modified,
        ...(includeContent ? { content: note.content.slice(0, 2500) } : {}),
      })),
    };
  }

  private async _listRecurrences(args: ToolArgs): Promise<Record<string, unknown>> {
    const projectId = this._optionalString(args, 'project_id');
    const [configs, tasks, projects] = await Promise.all([
      firstValueFrom(this._store.select(selectAllTaskRepeatCfgs)),
      this._allTasks(true),
      firstValueFrom(this._store.select(selectAllProjects)),
    ]);
    if (projectId && !projects.some((project) => project.id === projectId)) {
      throw new Error('Project not found.');
    }
    return {
      recurrences: configs
        .filter((cfg) => !projectId || cfg.projectId === projectId)
        .map((cfg) => ({
          id: cfg.id,
          task_ids: tasks
            .filter((task) => task.repeatCfgId === cfg.id)
            .map((task) => task.id),
          title: cfg.title,
          project_id: cfg.projectId,
          project:
            projects.find((project) => project.id === cfg.projectId)?.title ?? null,
          cycle: cfg.repeatCycle,
          every: cfg.repeatEvery,
          paused: cfg.isPaused,
          repeat_until: cfg.repeatUntilDay ?? null,
          weekdays: this._weekdays(cfg),
        })),
    };
  }

  private _weekdays(config: TaskRepeatCfg): string[] {
    return [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ].filter((day) => config[day as keyof TaskRepeatCfg] === true);
  }
}
