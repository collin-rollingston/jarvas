import { ipcMain } from 'electron';
import { IPC } from './shared-with-frontend/ipc-events.const';
import type {
  AssistantChatCompletion,
  AssistantChatRequestMessage,
  AssistantChatTool,
} from '../src/app/features/assistant-chat/assistant-chat.model';

const MODEL = '@cf/google/gemma-4-26b-a4b-it';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isRequestMessages = (value: unknown): value is AssistantChatRequestMessage[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 100 &&
  value.every((message: unknown) => {
    if (!isRecord(message)) return false;
    if (message.role === 'tool') {
      return (
        typeof message.tool_call_id === 'string' &&
        message.tool_call_id.length <= 200 &&
        typeof message.content === 'string' &&
        message.content.length <= 30000
      );
    }
    if (
      !['system', 'user', 'assistant'].includes(String(message.role)) ||
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
};
