export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: AssistantChatImage[];
}

export interface AssistantChatImage {
  dataUrl: string;
  filename: string;
}

export type AssistantChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export const MAX_ASSISTANT_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_ASSISTANT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ASSISTANT_IMAGES_PER_MESSAGE = 3;
export const MAX_ASSISTANT_IMAGES_PER_REQUEST = 4;
export const MAX_ASSISTANT_IMAGE_BYTES_PER_MESSAGE = 12 * 1024 * 1024;

export interface AssistantChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type AssistantChatRequestMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | AssistantChatContentPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: AssistantChatToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AssistantChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AssistantChatCompletion {
  choices?: {
    message?: {
      role?: 'assistant';
      content?: unknown;
      tool_calls?: AssistantChatToolCall[];
    };
  }[];
}

/** A host-owned chat contract. The host can execute local tools before yielding text. */
export interface AssistantChatAdapter {
  run(input: {
    messages: readonly AssistantChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
  transcribeAudio(input: { audio: Uint8Array }): Promise<string>;
}
