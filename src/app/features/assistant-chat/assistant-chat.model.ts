export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A host-owned, text-only stream contract for plugging in an agent. */
export interface AssistantChatAdapter {
  run(input: {
    messages: readonly AssistantChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
}
