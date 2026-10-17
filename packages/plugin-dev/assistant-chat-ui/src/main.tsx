import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import styles from './style.css?inline';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type AgentAdapter = {
  run(input: {
    messages: readonly ChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
};

interface AssistantChatElement extends HTMLElement {
  configure(config: {
    agentAdapter: AgentAdapter | null;
    locale: string;
    labels: ChatLabels;
  }): void;
}

type ChatLabels = {
  ready: string;
  connectAgent: string;
  connected: string;
  notConnected: string;
  cardTitle: string;
  cardBody: string;
  emptyTitle: string;
  emptyBody: string;
  inputLabel: string;
  inputPlaceholder: string;
  send: string;
  composerNote: string;
};

const disconnectedAdapter: ChatModelAdapter = {
  async run() {
    throw new Error('Connect an agent to start a conversation.');
  },
};

function Chat({
  connected,
  adapter,
  labels,
  locale,
}: {
  connected: boolean;
  adapter: ChatModelAdapter;
  labels: ChatLabels;
  locale: string;
}) {
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main
        className="assistant-chat"
        aria-label="Assistant chat"
        lang={locale}
      >
        <header className="chat-heading">
          <span
            className="chat-mark"
            aria-hidden="true"
          >
            ✳
          </span>
          <div>
            <h1>Jarvas</h1>
            <p>{connected ? labels.ready : labels.connectAgent}</p>
          </div>
          <span className={`connection-state${connected ? ' is-connected' : ''}`}>
            {connected ? labels.connected : labels.notConnected}
          </span>
        </header>
        {!connected && (
          <section
            className="connection-card"
            aria-live="polite"
          >
            <span
              className="connection-icon"
              aria-hidden="true"
            >
              ↗
            </span>
            <div>
              <h2>{labels.cardTitle}</h2>
              <p>{labels.cardBody}</p>
            </div>
          </section>
        )}
        <Thread
          connected={connected}
          labels={labels}
        />
      </main>
    </AssistantRuntimeProvider>
  );
}

function Thread({ connected, labels }: { connected: boolean; labels: ChatLabels }) {
  return (
    <ThreadPrimitive.Root className="thread-root">
      <ThreadPrimitive.Viewport
        className="thread-viewport"
        turnAnchor="top"
      >
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <div className="empty-thread">
            <span
              className="empty-glyph"
              aria-hidden="true"
            >
              ✳
            </span>
            <h2>{labels.emptyTitle}</h2>
            <p>{labels.emptyBody}</p>
          </div>
        </AuiIf>
        <ThreadPrimitive.Messages>
          {({ message }) => (
            <MessagePrimitive.Root
              className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
            >
              <MessagePrimitive.Parts />
            </MessagePrimitive.Root>
          )}
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="composer-footer">
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              aria-label={labels.inputLabel}
              placeholder={labels.inputPlaceholder}
              className="composer-input"
              rows={1}
              disabled={!connected}
            />
            <ComposerPrimitive.Send
              className="send-button"
              disabled={!connected}
              aria-label={labels.send}
            >
              ↑
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
          <p className="composer-note">{labels.composerNote}</p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

const DEFAULT_LABELS: ChatLabels = {
  ready: 'Your assistant is ready',
  connectAgent: 'Connect an agent to get started',
  connected: 'Connected',
  notConnected: 'Not connected',
  cardTitle: 'Your workspace, ready for an agent',
  cardBody:
    'The chat interface is installed locally. Connect your agent to start a conversation.',
  emptyTitle: 'What would you like to work on?',
  emptyBody: 'Your tasks and plans will be ready to discuss here.',
  inputLabel: 'Message your assistant',
  inputPlaceholder: 'Message your assistant…',
  send: 'Send message',
  composerNote: 'Your agent connection will enable chat.',
};

class AssistantChat extends HTMLElement implements AssistantChatElement {
  private root?: Root;
  private mount?: HTMLDivElement;
  private _agentAdapter: AgentAdapter | null = null;
  private _locale = 'en';
  private _labels?: ChatLabels;
  private _configured = false;

  configure(config: {
    agentAdapter: AgentAdapter | null;
    locale: string;
    labels: ChatLabels;
  }): void {
    this._agentAdapter = config.agentAdapter;
    this._locale = config.locale || 'en';
    this._labels = config.labels;
    this._configured = true;
    this.render();
  }

  connectedCallback(): void {
    if (this.root) return;
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    this.mount = document.createElement('div');
    this.mount.className = 'assistant-chat-mount';
    shadow.replaceChildren(style, this.mount);
    this.render();
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = undefined;
    this.mount = undefined;
  }

  private render(): void {
    if (!this.mount || !this._configured) return;
    this.root ??= createRoot(this.mount);
    const adapter = this._agentAdapter
      ? createAgentAdapter(this._agentAdapter)
      : disconnectedAdapter;
    this.root.render(
      <Chat
        connected={!!this._agentAdapter}
        adapter={adapter}
        labels={this._labels ?? DEFAULT_LABELS}
        locale={this._locale}
      />,
    );
  }
}

function createAgentAdapter(agentAdapter: AgentAdapter): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const requestMessages = messages.flatMap((message): ChatMessage[] => {
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        const content = message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        return content ? [{ role: message.role, content }] : [];
      });
      let text = '';
      for await (const chunk of agentAdapter.run({
        messages: requestMessages,
        signal: abortSignal,
      })) {
        text += chunk;
        yield { content: [{ type: 'text', text }] };
      }
    },
  };
}

if (!customElements.get('assistant-chat-ui')) {
  customElements.define('assistant-chat-ui', AssistantChat);
}

declare global {
  interface HTMLElementTagNameMap {
    'assistant-chat-ui': AssistantChat;
  }
}
