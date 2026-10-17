# assistant-ui as the new app interface

Oct 17, 2026 · status: chat shell pilot implemented; feature migration not started

## 1. Goal

Make an assistant conversation the app’s primary and eventually only user-facing
work surface. Users should be able to capture, find, plan, change, and track work
through an agent conversation, with compact interactive cards and controls where
plain text is awkward. Retire the existing task pages, navigation, and app shell
only as each capability has a tested replacement.

This is a UI replacement, not a rewrite of Super Productivity’s domain layer.
Keep its task and project models, NgRx reducers, services, IndexedDB persistence,
operation log, sync providers, integrations, Electron and mobile bridges. All
mutations continue through the existing domain services and operation pipeline.
No chat transcript or agent activity enters synced state as part of this plan.

The end state has one chat-led application surface. Small task lists, date
controls, timer actions, confirmations, settings forms, and planning summaries
may render as first-party assistant-ui message components. They are part of the
conversation; they do not retain a parallel page-based application or second
navigation system. OS-level menus and platform lifecycle/recovery behavior remain
platform responsibilities.

## 2. Recommendation

Use the pinned `@assistant-ui/react` primitives in an isolated React build
workspace at `packages/plugin-dev/assistant-chat-ui/`. Keep its React
dependencies out of the root app package. The locally maintained wrapper,
adapter, and styles build into a self-contained custom element and static JS
asset; Angular loads it on a dedicated `/assistant` route. The route hides the
existing navigation and header, with a return path to the task interface. The
assistant chat is first-party app UI, not a user-managed plugin. The Angular
host remains responsible for app state, domain commands, routing, platform
integrations, theme, locale, and sync.

The package is build-time input only: Vite bundles the pinned assistant-ui and
React code into the app's local asset. The runtime does not fetch code, fonts,
styles, or other UI assets from an external host. Do not run `assistant-ui init`
in the Angular root or add React/assistant-ui to root dependencies. The local MIT
notice is kept in `packages/plugin-dev/assistant-chat-ui/LICENSES.md`; the lockfile
records exact dependency versions. The first-party bundle is built by
`packages/build-packages.js` and is not registered with the optional plugin
runtime.

Use assistant-ui `LocalRuntime` with a host-owned adapter for the agent stream.
Keep chat state inside that runtime, not NgRx. Pick the adapter protocol after the
agent endpoint is defined; do not add an assistant-ui hosted service, provider
key, or model backend just to make the interface work. Start with one ephemeral
thread. If durable history is later needed, use a local-only history adapter and
an app-owned store, with explicit deletion and export behavior.

### Integration feasibility gate

Before porting screens, build a small end-to-end spike that proves all of these:

1. The React chat bundle builds in the isolated UI workspace without adding
   dependencies to the root `package.json`.
2. The custom element and styles are emitted as local static assets and load in
   the web build, Electron `file://` build, and Android/iOS web views without a
   network connection or development server.
3. Angular can mount and unmount the custom element cleanly, and route changes,
   keyboard focus, shortcuts, stop/cancel, resize, mobile keyboard, and
   accessibility work without a cross-frame bridge.
4. A typed agent-adapter contract can stream one read-only response. Invalid
   messages are rendered as text/markdown only; they cannot execute code or
   mutate app state.
5. The bundle’s compressed size, startup cost, CSP requirements, and packaging
   are measured against the current frontend budgets on desktop and mobile.

If custom-element packaging or lifecycle fails those checks, stop before UI
migration and review the architecture. Do not silently move React dependencies to
the root or replace Angular wholesale as a workaround.

## 3. What the system already provides

- The Angular root composes navigation, header, route outlet, panels, mobile
  navigation, overlays, and app-wide controls in
  [`src/app/app.component.html`](../../src/app/app.component.html). Top-level
  pages and work-context routes are declared in
  [`src/app/app.routes.ts`](../../src/app/app.routes.ts).
- The app map describes the shell-to-feature dependency direction in
  [`src/app/README.md`](../../src/app/README.md). The root shell can be replaced
  while domain feature services and the operation log remain in place.
- The current plugin workspace is intentionally isolated from the root install,
  and its Vite plugins already inline/bundle static UI assets. The plugin iframe
  path is optional and same-origin, so it is a poor primary-shell boundary.
  Reuse the isolated build-workspace pattern, but load this trusted first-party
  UI as a local custom element rather than registering it as a removable plugin.
  See [`packages/plugin-dev/README.md`](../../packages/plugin-dev/README.md),
  [`packages/build-packages.js`](../../packages/build-packages.js), and
  [`packages/README.md`](../../packages/README.md).
- One task or time-tracking intent must still create the existing local action
  and operation. Remote replay must not re-run assistant or other local effects.
  See [`docs/sync-and-op-log/contributor-sync-model.md`](../sync-and-op-log/contributor-sync-model.md).
- The product is offline-first and private by default. A chat-only surface must
  preserve offline task capture and time tracking, and it must not send task or
  conversation content to a provider without an explicit agent connection and
  disclosure.

## 4. Prior art

Sources checked Oct 2026. This comparison uses official project documentation
and project metadata; no products were tested hands-on. The selected assistant-ui
package is pinned to 0.15.28, and its MIT notice is stored locally with the UI
package.

| Project                                                                                                                                                   | Useful interaction and integration pattern                                                                                     | Fit for this app                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [assistant-ui](https://www.assistant-ui.com/docs/cli), [runtime docs](https://www.assistant-ui.com/docs/runtimes/concepts/architecture)                   | React thread/composer primitives; custom runtimes adapt to an app-owned agent; provides message branches and history seams.    | Selected. Rich enough to own chat UX while leaving agent protocol and data services to this app. React means an isolated bundle is required.                                          |
| [CopilotKit Angular](https://docs.copilotkit.ai/reference/angular), [chat component](https://docs.copilotkit.ai/reference/angular/components/CopilotChat) | First-party Angular chat surface, signal-based integration, agent tools and custom message renderers.                          | Strongest host-framework fit and important fallback comparison. It is a separate agent UI/runtime choice; combining it with assistant-ui would duplicate runtime and message models.  |
| [Deep Chat](https://github.com/OvidijusParsiunas/deep-chat), [connection docs](https://deepchat.dev/docs/connect/)                                        | Embeddable web component, supports Angular and custom request handlers, and can render a chat without replacing the app shell. | Lower integration cost for a conventional chat pane. Less aligned with the richer thread/runtime experience chosen here; still needs a safe adapter and an isolated agent connection. |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat)                                                                                                    | Full self-hosted chat product with agent management, MCP, multiple providers, threads, and backend services.                   | Useful reference for agent activity and thread controls. Its application, backend, auth, and provider configuration are too broad to embed as this app’s UI layer.                    |

**Take:** assistant-ui thread/composer primitives, an app-owned typed runtime,
explicit tool progress/results, and thread history through an app-owned adapter
if needed.

**Deliberately don’t:** copy a complete chat application; introduce a hosted
conversation store; connect the browser directly to a model key; add multiple UI
runtimes; or let the agent return executable HTML/JS as a UI. Build fixed,
validated message components for Super Productivity tasks and actions.

## 5. Interaction and system contracts

### 5.1 Agent boundary

Keep the agent transport behind one typed adapter owned by the custom element.
The React app receives validated display messages, tool status, and registered
component data. The host owns app queries, command execution, user confirmation,
and state refresh. No arbitrary Redux/NgRx action, generic state write, or
`getAppState()` dump is exposed to the model.

Expose narrow commands with JSON schemas and runtime validation. Start with
read-only search and task/project context. Add writes in small groups through the
existing `TaskService`, `TimeTrackingService`, scheduling, and project/tag
services. Commands resolve IDs and current state at execution time; an agent’s
stale message is never treated as authority. Confirm delete, archive, bulk
changes, or any action whose scope is ambiguous. Show the requested change and
the result in the thread. Do not log titles, notes, prompts, transcripts, or
provider payloads.

The custom element shares the app’s JavaScript realm. Only ship its
first-party compiled bundle as trusted app code; never render or execute code
returned by an agent. Keep tool execution in the Angular host and pass the
assistant-ui runtime a typed adapter. Do not expand the public third-party Plugin
API merely to serve the first-party chat.

### 5.2 Offline, privacy, and persistence

- Task capture, task changes, starting/stopping a timer, and core time tracking
  must work offline. Provide local commands or structured quick actions inside
  the same composer so those operations do not require a remote model.
- Agent access is opt-in. Make clear which task/context data is sent to the
  configured agent. Send only the context required for the current request; do
  not send the full application state by default.
- Do not store conversation content in synced models, operation payloads,
  `PluginAPI` synced data, or localStorage. The first usable release keeps one
  thread in memory. A later local-history decision must select IndexedDB or the
  app’s approved persistence boundary, define cleanup/export, and avoid changing
  the sync wire.
- If the agent is unavailable, preserve local commands and show connection state
  in the composer. Never report a mutation as complete until the host service
  confirms it.

### 5.3 Chat components and accessibility

Use assistant-ui's pinned React primitives for the thread, composer, and message
content. Implement fixed local React renderers for task cards, task-result lists,
dates, timer status, approvals, and
settings controls. These components must support keyboard use, screen readers,
high contrast, dark/light themes, right-to-left layout, translations, focus
management, and the app’s mobile viewport/keyboard behavior. Render large results
in paged or grouped form, not as one enormous transcript message. Pass host
theme/locale/direction into the custom element and map them to the chat’s CSS
custom properties and translation catalog. Follow the [theme contract](../theming-contract.md) and
[translation workflow](../TRANSLATING.md); do not fork a second unrelated theme
or translation system.

## 6. Migration sequence and exit criteria

### Phase 0 — inventory and feasibility spike

**Implemented in this PR:** isolated React workspace with pinned dependencies,
locally bundled assistant-ui runtime, lazy Angular `/assistant` route, full-screen
chat shell with return navigation, localized host labels, theme-token styles,
and a typed text-stream adapter seam. The composer remains disabled because no
agent is configured. The minified asset is 1,046.28 kB (311.79 kB gzip).

**Still required before the feasibility gate passes:** full route/action
inventory and capability matrix; packaged Electron/Android/iOS and offline
smoke checks; interactive adapter streaming/cancellation checks; keyboard,
focus, screen-reader, responsive keyboard, and route teardown review; and bundle
startup/CSP assessment. This PR does not claim those checks pass.

1. Inventory every route, navigation entry, keyboard shortcut, task action,
   configuration flow, integration, and mobile behavior. Group them under task
   capture/editing, work contexts, planning, time tracking, reports, settings,
   sync/backup/import/export, plugins, and onboarding/recovery.
2. Create a capability matrix: old entry point, underlying domain service/action,
   proposed conversational prompt/control, read/write scope, offline behavior,
   desktop/mobile access, accessibility requirements, and retirement evidence.
3. Create the isolated first-party UI workspace, adapt only the assistant-ui
   primitives needed by the shell, pin each package exactly, and keep the MIT
   notice with the local package.
4. Build one full-screen route and one read-only stream using a contract-level
   adapter fixture. Measure package output and test web, Electron, Android, and
   iOS loading and lifecycle behavior.

**Exit:** the feasibility checks in §2 pass, the capability matrix covers every
current user-facing route, and the adapter contract is written down. If size,
packaging, keyboard/focus, or offline behavior cannot meet requirements, revise
the approach before adding feature coverage.

### Phase 1 — chat shell beside the current app

Ship the new chat route as an explicit pilot while existing routes still work.
The current implementation provides the local shell and one ephemeral thread,
but has no connected agent, task commands, search, tool status, or stop/retry
flows. Keep those items in this phase before treating the pilot as feature
complete. Add no model credentials or cloud transcript service to the client.

**Exit:** users can start a conversation, navigate results, complete core offline
capture/timer actions, and recover cleanly from agent disconnects. Accessibility
and platform packaging work on all supported clients. The pilot shows that
chat-led capture/find/act flows reduce steps or improve a documented workflow;
otherwise do not migrate the remaining UI.

### Phase 2 — safe action bridge

Add a typed host command bridge with schema validation, authorization by
capability, current-state checks, cancellation, and clear success/failure
results. Add one write family at a time: create/edit/complete tasks; schedule and
unschedule; start/stop tracking; then projects/tags and recurring tasks. Preserve
one intent = one operation and existing action/effect/replay contracts. Add
preview/confirmation for destructive, broad, or ambiguous changes. Keep agent
requests and responses out of logs.

**Exit:** each command has an explicit allowed-data/allowed-action contract,
invalid and stale IDs fail safely, remote sync replay never calls the agent, and
each successful mutation uses the same domain operation path as the old UI.

### Phase 3 — replace page families in capability slices

Migrate the following families in order, retaining old routes as temporary
fallbacks until that family passes its parity checklist:

1. Task list, Inbox, Today, backlog, project/tag task contexts, task details,
   repeat configuration, search, and completion/reopen flows.
2. Scheduling, planner, boards, and calendar-facing interactions. Use
   assistant-ui task/date/planning components for dense interactions where
   conversation text alone would slow the user down.
3. Timer, Pomodoro, focus/break flow, worklog, and time reports.
4. Settings and preferences, integrations, sync setup/status, backup,
   import/export, plugin management, onboarding, and recovery/error flows.

For each family, map every current screen action to a chat command or a
first-party in-thread control. Maintain keyboard shortcuts and mobile affordances
through the composer and host bridge. Treat configuration and confirmation as
part of the chat flow, not a new route tree. Do not create a permanent user
setting to keep both interfaces.

**Exit per family:** all supported existing actions have a replacement; data and
sync behavior are unchanged; offline behavior is documented; keyboard, mobile,
translation, accessibility, error, and migration paths are covered; support docs
and help links point to the new flow. Then remove that family’s old navigation
entry and route.

### Phase 4 — default cutover and removal

Make chat the default launch route. Remove old navigation, page routes,
components, styles, translations, shortcut code, obsolete route guards, and
page-specific tests only after their capability slices have passed. Retain
domain services, reducers, models, sync operation handlers, persistence,
integrations, platform bridges, and any first-party in-thread renderer still
needed. Remove the temporary fallback path and any rollout-only switch.

**Exit:** no user-facing route, navigation item, or app control reaches the
retired task/planner/settings screen UI; all required capabilities are available
from chat or its fixed in-thread controls; app builds launch correctly across
web, desktop, Android, and iOS; existing local data opens without migration or
data loss; and help/translation/accessibility surfaces describe the new UI.

## 7. Validation plan for implementation

The isolated assistant-chat-ui TypeScript check and Vite production build passed.
The targeted `npm run build:assistant-chat-ui` also passed and copied the bundle
to app assets. The output was 1,046.28 kB minified and 311.79 kB gzip. `npm run
int` regenerated the app translation constants, and checkFile passed for the
modified app TypeScript/SCSS files. The full `npm run build:packages` stopped on
uninstalled dependencies in unrelated optional plugin workspaces. Angular's
development build stopped before compilation because the installed Node 24.14.1
is below Angular's minimum 24.15.0. Platform smoke checks have not been run; no
test suite was run for this pilot.
During implementation, validate at each phase with focused unit/spec coverage
for host commands and plugin bridge, browser E2E for conversation + actions, and
packaged smoke checks for Electron and mobile. Use the existing test and
platform commands in [`AGENTS.md`](../../AGENTS.md) and the E2E/platform guidance
in [`docs/repository-map.md`](../repository-map.md).

Required scenarios include: empty/long/error/streaming messages; stop and retry;
agent disconnect while offline commands still work; malformed tool arguments;
stale/deleted task IDs; confirmation cancel/accept; repeated and interrupted tool
calls; sync receiving the same mutation on another device; keyboard focus and
shortcuts across route mount/unmount; mobile virtual keyboard and screen rotation;
large result sets; screen reader labels; RTL and theme changes; packaging without
external assets; and existing v18 persisted state opening unchanged.

## 8. Risks and unresolved decisions

| Risk / decision                                                                             | Plan response                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React custom element and Angular host add two UI runtimes and a lifecycle seam to maintain. | The first bundle is 311.79 kB gzip; prove startup, teardown, theme/locale updates, and keyboard behavior across platforms before migrating pages.                 |
| assistant-ui API changes across versions.                                                   | Pin dependencies, keep the host wrapper small, retain the local license notice, and review package updates as explicit lockfile and behavior changes.             |
| Agent protocol is not yet specified.                                                        | Keep transport behind an adapter; choose its stream, tool, cancellation, and approval semantics during Phase 0. MCP alone is not assumed to be the chat protocol. |
| Conversational workflows may be slower for dense planning or configuration.                 | Use fixed, keyboard-accessible assistant-ui components in the thread and require workflow evidence before retiring a screen.                                      |
| Removing the old UI can strand users during an agent outage.                                | Core task/time commands remain local and offline; phase exits include fallback and recovery behavior.                                                             |
| Conversation history can contain task-sensitive data.                                       | Keep it ephemeral initially; if persistence is approved later, keep it local, deletable/exportable, and outside sync by default.                                  |
| Custom element shares the host JavaScript realm.                                            | Treat the bundle as trusted app code; validate host commands and never execute agent-generated code.                                                              |
| Tool mutation expands a durable contract.                                                   | Avoid exposing generic app actions or a broad third-party Plugin API; keep commands narrow and review public API changes separately.                              |

Open before extending the pilot: final agent endpoint/protocol; whether users need
local durable conversation history; exact old-screen action inventory and
feature parity list; acceptable bundle-size/startup budgets; and which actions
need confirmation beyond destructive and bulk operations.

## References

- [assistant-ui CLI and component registry](https://www.assistant-ui.com/docs/cli)
- [assistant-ui runtime architecture and custom adapters](https://www.assistant-ui.com/docs/runtimes/concepts/architecture)
- [assistant-ui threads and default in-memory behavior](https://www.assistant-ui.com/docs/runtimes/concepts/threads)
- [assistant-ui history adapters](https://www.assistant-ui.com/docs/runtimes/concepts/adapters)
- [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [Locally stored assistant-ui license notice](../../packages/plugin-dev/assistant-chat-ui/LICENSES.md)
- [AGENTS.md](../../AGENTS.md), [repository content map](../repository-map.md), [app layer map](../../src/app/README.md)
- [Plugin development](../plugin-development.md), [package ownership and validation](../../packages/README.md)
- [Feature review guide: prior art and long-term cost](../feature-review-guide.md)
