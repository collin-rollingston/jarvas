# Jarvas

Jarvas is a personal productivity workspace built on Super Productivity. It combines task planning and time tracking with an integrated AI chat assistant that can read and manage your work through the same app services as the rest of the application.

## What Jarvas does

- Capture and organize tasks with projects, tags, subtasks, due dates, reminders, and recurring schedules.
- Plan work for today, track time, review time summaries, and manage project notes.
- Ask Jarvas in chat to find tasks, understand your plan, prioritize work, create or update tasks, manage projects and tags, edit notes, and start or stop time tracking.
- Attach images with the plus button or dictate a message with the microphone. Voice is transcribed first; you review the text and send it yourself.
- Keep chat threads on this device. Jarvas names each thread from its opening message and saves the conversation in local IndexedDB, so it survives refreshes. Chat history is not part of app backups or exports and does not sync between devices.

The assistant can make changes to your productivity data. Destructive task, project, tag, and note actions require a one-time confirmation code in chat.

## Run Jarvas locally

Use Node.js **22.23.3**, as pinned in `.nvmrc`, and npm. From the repository root:

```sh
npm ci
```

Create `.env.local` beside `package.json` and add your Cloudflare account ID and Workers AI API token:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-workers-ai-api-token
```

Use a Cloudflare API token with Workers AI permissions. The repository's `.env.local` is ignored by Git; keep the real token there and never commit it.

Start the desktop app:

```sh
npm start
```

Or start the browser development app:

```sh
npm run startFrontend
```

The browser app is served at `http://localhost:4300`. Open the Assistant page from the app navigation. Use **New thread** to begin a conversation, then describe what you want in the prompt. The assistant can ask follow-up questions and request confirmation before destructive changes.

## Assistant model and data flow

Chat completions and image understanding use **Cloudflare Workers AI** with `@cf/google/gemma-4-26b-a4b-it`. Voice transcription uses Cloudflare's `@cf/openai/whisper-large-v3-turbo` model. The assistant calls Jarvas tools for productivity actions; those calls go through the app's existing services and state handling.

The Cloudflare token stays in the Electron main process or the local development proxy. It is not bundled into the browser UI. When you use the assistant, Jarvas sends the conversation and relevant tool context to Cloudflare. This may include task, project, and tag details. Note contents are left out unless you ask Jarvas to inspect or edit them. Audio is sent after you stop recording and is not saved by Jarvas. Image attachments are sent with your message (up to 3 images, 5 MB each, 12 MB total); recent images can be included again as chat context. Chat history stays in the local app profile.

See the [Assistant Chat guide](docs/wiki/3.10-Assistant-Chat.md) for the full tool list, image and voice behavior, confirmation flow, and data-sharing details. The [User Data guide](docs/wiki/3.06-User-Data.md) explains local storage and backup boundaries.

## Main technologies

- **Angular 22** powers the Super Productivity application and its task, planning, and settings screens; **NgRx 22** manages structured productivity state.
- **Electron 44** provides the desktop app and keeps Cloudflare credentials in the main process; **Capacitor 8** supports mobile app shells.
- The assistant chat UI is bundled locally and uses **React 19**, **`@assistant-ui/react` 0.15**, and **`@assistant-ui/core` 0.3**. It is integrated into the Angular app without loading chat code from a remote host.
- Assistant requests use Cloudflare's Workers AI HTTP API through the existing Electron IPC or development proxy. The repo does not need a separate Cloudflare SDK package.

The repository includes the broader Super Productivity codebase and its existing plugins and integrations. See [`docs/repository-map.md`](docs/repository-map.md) to find implementation areas.
