export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type AssistantChatRequestMessage =
  | { role: 'system' | 'user'; content: string }
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
}
