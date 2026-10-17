import { ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import type {
  AssistantChatCompletion,
  AssistantChatContentPart,
  AssistantChatRequestMessage,
  AssistantChatTool,
} from '../src/app/features/assistant-chat/assistant-chat.model';
import {
  MAX_ASSISTANT_AUDIO_BYTES,
  MAX_ASSISTANT_IMAGE_BYTES,
  MAX_ASSISTANT_IMAGE_BYTES_PER_MESSAGE,
  MAX_ASSISTANT_IMAGES_PER_MESSAGE,
  MAX_ASSISTANT_IMAGES_PER_REQUEST,
} from '../src/app/features/assistant-chat/assistant-chat.model';

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const TRANSCRIPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const getDataImageBytes = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match) return null;
  const base64 = match[1];
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((base64.length * 3) / 4) - padding;
  return byteLength > 0 && byteLength <= MAX_ASSISTANT_IMAGE_BYTES ? byteLength : null;
};

const isAssistantChatContentPart = (
  value: unknown,
): value is AssistantChatContentPart => {
  if (!isRecord(value)) return false;
  if (value.type === 'text') {
    return typeof value.text === 'string' && value.text.length <= 30000;
  }
  if (value.type !== 'image_url' || !isRecord(value.image_url)) return false;
  return getDataImageBytes(value.image_url.url) !== null;
};

const isRequestMessages = (value: unknown): value is AssistantChatRequestMessage[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false;
  let requestImageCount = 0;

  return value.every((message: unknown) => {
    if (!isRecord(message)) return false;
    if (message.role === 'tool') {
      return (
        typeof message.tool_call_id === 'string' &&
        message.tool_call_id.length <= 200 &&
        typeof message.content === 'string' &&
        message.content.length <= 30000
      );
    }
    if (!['system', 'user', 'assistant'].includes(String(message.role))) {
      return false;
    }
    if (Array.isArray(message.content)) {
      if (
        message.role !== 'user' ||
        message.content.length === 0 ||
        message.content.length > 4
      ) {
        return false;
      }
      let messageImageCount = 0;
      let messageImageBytes = 0;
      for (const part of message.content) {
        if (!isAssistantChatContentPart(part)) return false;
        if (part.type === 'image_url') {
          const imageBytes = getDataImageBytes(part.image_url.url);
          if (imageBytes === null) return false;
          messageImageCount++;
          messageImageBytes += imageBytes;
        }
      }
      requestImageCount += messageImageCount;
      if (
        messageImageCount === 0 ||
        messageImageCount > MAX_ASSISTANT_IMAGES_PER_MESSAGE ||
        messageImageBytes > MAX_ASSISTANT_IMAGE_BYTES_PER_MESSAGE ||
        requestImageCount > MAX_ASSISTANT_IMAGES_PER_REQUEST
      ) {
        return false;
      }
    } else if (
      (typeof message.content !== 'string' &&
        !(message.role === 'assistant' && message.content === null)) ||
      (typeof message.content === 'string' && message.content.length > 30000)
    ) {
      return false;
    }
    if (message.tool_calls === undefined) return true;
    return (
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length <= 8 &&
      message.tool_calls.every((call: unknown) => {
        if (!isRecord(call) || !isRecord(call.function)) return false;
        return (
          typeof call.id === 'string' &&
          call.id.length <= 200 &&
          call.type === 'function' &&
          typeof call.function.name === 'string' &&
          call.function.name.length <= 100 &&
          typeof call.function.arguments === 'string' &&
          call.function.arguments.length <= 20000
        );
      })
    );
  });
};

const isRequestTools = (value: unknown): value is AssistantChatTool[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 40 &&
  value.every((tool: unknown) => {
    if (!isRecord(tool) || !isRecord(tool.function)) return false;
    return (
      tool.type === 'function' &&
      typeof tool.function.name === 'string' &&
      tool.function.name.length <= 100 &&
      typeof tool.function.description === 'string' &&
      tool.function.description.length <= 2000 &&
      isRecord(tool.function.parameters)
    );
  });

const runCloudflareChatCompletion = async (
  messages: AssistantChatRequestMessage[],
  tools: AssistantChatTool[],
): Promise<AssistantChatCompletion> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      'Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local, then restart Jarvas.',
    );
  }

  const headers = new Headers();
  headers.set('Authorization', 'Bearer ' + apiToken);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(accountId) +
      '/ai/v1/chat/completions',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        stream: false,
      }),
    },
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Cloudflare rejected the request. Check the token and Workers AI permissions in .env.local.',
      );
    }
    throw new Error('Cloudflare Workers AI request failed (' + response.status + ').');
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !payload.choices.length) {
    throw new Error('Cloudflare Workers AI returned an empty response.');
  }
  return payload as AssistantChatCompletion;
};

const runCloudflareTranscription = async (audio: Uint8Array): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      'Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to .env.local, then restart Jarvas.',
    );
  }

  if (audio.byteLength === 0 || audio.byteLength > MAX_ASSISTANT_AUDIO_BYTES) {
    throw new Error('The recording is empty or too large to transcribe.');
  }

  const headers = new Headers();
  headers.set('Authorization', 'Bearer ' + apiToken);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' +
      encodeURIComponent(accountId) +
      '/ai/run/' +
      TRANSCRIPTION_MODEL,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audio: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString(
          'base64',
        ),
        task: 'transcribe',
      }),
    },
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Cloudflare rejected the recording. Check the token and Workers AI permissions in .env.local.',
      );
    }
    throw new Error(
      'Cloudflare Workers AI transcription failed (' + response.status + ').',
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error('Cloudflare Workers AI returned an invalid transcription.');
  }
  const result = isRecord(payload.result) ? payload.result : payload;
  if (typeof result.text !== 'string') {
    throw new Error('Cloudflare Workers AI returned an empty transcription.');
  }
  return result.text;
};

export const initAssistantChatIpc = (): void => {
  ipcMain.handle(
    IPC.ASSISTANT_CHAT_COMPLETION,
    (_event, messages: unknown, tools: unknown) => {
      if (!isRequestMessages(messages) || !isRequestTools(tools)) {
        throw new Error('Invalid assistant chat request.');
      }
      return runCloudflareChatCompletion(messages, tools);
    },
  );
  ipcMain.handle(IPC.ASSISTANT_CHAT_TRANSCRIBE, (_event, audio: unknown) => {
    if (!(audio instanceof Uint8Array)) {
      throw new Error('Invalid assistant audio request.');
    }
    return runCloudflareTranscription(audio);
  });
};
