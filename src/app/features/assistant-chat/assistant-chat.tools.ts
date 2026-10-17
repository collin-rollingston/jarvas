import { AssistantChatTool } from './assistant-chat.model';

const string = { type: 'string' };
const nullableString = { type: ['string', 'null'] };
const number = { type: 'number' };
const boolean = { type: 'boolean' };

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const tool = (
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): AssistantChatTool => ({
  type: 'function',
  function: { name, description, parameters },
});

export const ASSISTANT_CHAT_TOOLS: AssistantChatTool[] = [
  tool(
    'search_tasks',
    'Search active or archived tasks. Use this to resolve titles to task IDs before changing a task. Notes are excluded unless the user explicitly asks to inspect them.',
    object(
      {
        query: string,
        status: { type: 'string', enum: ['open', 'done', 'all'] },
        project_id: string,
        tag_id: string,
        planned_for: {
          type: 'string',
          enum: ['today', 'backlog', 'upcoming', 'overdue'],
        },
        due_from: string,
        due_to: string,
        include_archived: boolean,
        include_notes: boolean,
        limit: { type: 'integer', minimum: 1, maximum: 40 },
      },
      [],
    ),
  ),
  tool(
    'get_task_details',
    'Read one task by its exact ID. Include notes only when the user asked to inspect task notes.',
    object(
      {
        task_id: string,
        include_notes: boolean,
      },
      ['task_id'],
    ),
  ),
  tool(
    'get_today_plan',
    'Read today’s planned tasks in their current order, including completion and estimates.',
    object({}),
  ),
  tool(
    'reorder_today_task',
    'Move an open task up, down, to the top, or to the bottom of the Today plan. Read get_today_plan first to confirm its current position.',
    object(
      {
        task_id: string,
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
      },
      ['task_id', 'direction'],
    ),
  ),
  tool(
    'get_time_summary',
    'Summarize recorded time across a date range. Dates use YYYY-MM-DD. Include task names only when useful to answer the user.',
    object(
      {
        from: string,
        to: string,
        project_id: string,
        task_id: string,
      },
      [],
    ),
  ),
  tool(
    'list_projects',
    'List projects and their active/archive status.',
    object({ include_archived: boolean }),
  ),
  tool(
    'list_tags',
    'List user tags. The virtual Today tag is not assignable to tasks.',
    object({}),
  ),
  tool(
    'list_notes',
    'List note records. Note bodies are private and excluded unless include_content is explicitly true because the user asked to read note content.',
    object(
      {
        project_id: string,
        include_today: boolean,
        include_content: boolean,
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      [],
    ),
  ),
  tool('list_recurrences', 'List recurring task rules.', object({ project_id: string })),
  tool(
    'create_task',
    'Create one task. Use an existing project or tag ID from a list/search tool. Date values must be ISO dates or timestamps. Ask the user if the target project or task is ambiguous.',
    object(
      {
        title: string,
        project_id: string,
        tag_ids: { type: 'array', items: string },
        notes: string,
        priority: { type: 'integer', enum: [1, 2, 3] },
        estimate_minutes: number,
        due_day: string,
        due_at: string,
        deadline_day: string,
        deadline_at: string,
        reminder: {
          type: 'string',
          enum: ['DoNotRemind', 'AtStart', 'm5', 'm10', 'm15', 'm30', 'h1'],
        },
        add_to_backlog: boolean,
      },
      ['title'],
    ),
  ),
  tool(
    'create_subtask',
    'Create a subtask under an existing parent task ID.',
    object(
      {
        parent_task_id: string,
        title: string,
        notes: string,
        estimate_minutes: number,
        priority: { type: 'integer', enum: [1, 2, 3] },
      },
      ['parent_task_id', 'title'],
    ),
  ),
  tool(
    'update_task',
    'Update editable task fields and deadlines. Use plan_task to change or clear a scheduled due date. Use clear_deadline to remove a deadline.',
    object(
      {
        task_id: string,
        title: string,
        notes: string,
        priority: { anyOf: [{ type: 'integer', enum: [1, 2, 3] }, { type: 'null' }] },
        estimate_minutes: number,
        project_id: string,
        deadline_day: string,
        deadline_at: string,
        clear_deadline: boolean,
      },
      ['task_id'],
    ),
  ),
  tool(
    'set_task_completion',
    'Complete or reopen a task.',
    object(
      {
        task_id: string,
        is_done: boolean,
      },
      ['task_id', 'is_done'],
    ),
  ),
  tool(
    'plan_task',
    'Plan a task for an all-day date, an exact ISO timestamp, or remove its plan when both date fields are null. For today, use the app planning action so it appears in the Today list.',
    object(
      {
        task_id: string,
        due_day: nullableString,
        due_at: nullableString,
        reminder: {
          type: 'string',
          enum: ['DoNotRemind', 'AtStart', 'm5', 'm10', 'm15', 'm30', 'h1'],
        },
      },
      ['task_id', 'due_day', 'due_at'],
    ),
  ),
  tool(
    'set_task_tags',
    'Replace a task’s user tags. Use list_tags first and do not use the virtual Today tag ID.',
    object(
      {
        task_id: string,
        tag_ids: { type: 'array', items: string },
      },
      ['task_id', 'tag_ids'],
    ),
  ),
  tool(
    'move_task_to_backlog',
    'Move a top-level task from its project’s active list into that project’s backlog.',
    object({ task_id: string }, ['task_id']),
  ),
  tool(
    'move_task_from_backlog',
    'Move a top-level task from its project backlog into the project’s active list.',
    object({ task_id: string }, ['task_id']),
  ),
  tool(
    'delete_task',
    'Permanently delete a task and its subtasks. This always asks the user to type the displayed confirmation code before executing.',
    object({ task_id: string }, ['task_id']),
  ),
  tool(
    'archive_task',
    'Move a top-level task and its subtasks to the archive. The task can later be restored.',
    object({ task_id: string }, ['task_id']),
  ),
  tool(
    'restore_task',
    'Restore an archived task and its archived subtasks.',
    object({ task_id: string }, ['task_id']),
  ),
  tool(
    'start_tracking',
    'Start tracking a task. Starting a different task switches the active timer.',
    object({ task_id: string }, ['task_id']),
  ),
  tool('stop_tracking', 'Stop the currently tracked task.', object({})),
  tool(
    'log_time',
    'Add a manual time entry in minutes for a task on an ISO date (defaults to today).',
    object(
      {
        task_id: string,
        minutes: number,
        date: string,
      },
      ['task_id', 'minutes'],
    ),
  ),
  tool(
    'set_task_reminder',
    'Set or clear a due-time or deadline reminder. Due reminders require a timed due date; deadline reminders require a timed deadline.',
    object(
      {
        task_id: string,
        kind: { type: 'string', enum: ['due', 'deadline'] },
        reminder: {
          type: 'string',
          enum: [
            'DoNotRemind',
            'AtStart',
            'm5',
            'm10',
            'm15',
            'm30',
            'h1',
            'd1',
            'd3',
            'w1',
          ],
        },
      },
      ['task_id', 'kind', 'reminder'],
    ),
  ),
  tool(
    'create_project',
    'Create a project.',
    object({ title: string, enable_backlog: boolean }, ['title']),
  ),
  tool(
    'update_project',
    'Update a project title, backlog setting, or archived state.',
    object(
      {
        project_id: string,
        title: string,
        enable_backlog: boolean,
        is_archived: boolean,
      },
      ['project_id'],
    ),
  ),
  tool(
    'delete_project',
    'Permanently delete a project, its tasks, and its notes. This always asks the user to type the displayed confirmation code before executing.',
    object({ project_id: string }, ['project_id']),
  ),
  tool(
    'create_tag',
    'Create a user tag.',
    object({ title: string, color: string }, ['title']),
  ),
  tool(
    'update_tag',
    'Update a user tag title or color. Do not use this for the virtual Today tag.',
    object({ tag_id: string, title: string, color: string }, ['tag_id']),
  ),
  tool(
    'delete_tag',
    'Delete a user tag and remove its assignments. This always asks the user to type the displayed confirmation code before executing.',
    object({ tag_id: string }, ['tag_id']),
  ),
  tool(
    'create_note',
    'Create a note from content the user provided. Notes are sent to Cloudflare only when the user asks the assistant to work with that note.',
    object({ content: string, project_id: string, pin_to_today: boolean }, ['content']),
  ),
  tool(
    'update_note',
    'Replace note content or move the note to another project. Read note content first only when the user asks for an edit that depends on existing text.',
    object({ note_id: string, content: string, project_id: string }, ['note_id']),
  ),
  tool(
    'delete_note',
    'Permanently delete one note. This always asks the user to type the displayed confirmation code before executing.',
    object({ note_id: string }, ['note_id']),
  ),
  tool(
    'set_task_recurrence',
    'Create or update a recurring rule on a task. Weekly weekdays are lowercase names. A null repeat_until removes the end date.',
    object(
      {
        task_id: string,
        cycle: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] },
        every: { type: 'integer', minimum: 1, maximum: 365 },
        weekdays: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday',
              'sunday',
            ],
          },
        },
        repeat_until: nullableString,
        paused: boolean,
      },
      ['task_id', 'cycle'],
    ),
  ),
  tool(
    'switch_work_context',
    'Open a project, tag, or Today list in Jarvas.',
    object(
      {
        type: { type: 'string', enum: ['project', 'tag', 'today'] },
        context_id: string,
      },
      ['type'],
    ),
  ),
];
