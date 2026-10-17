import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  WebSpeechDictationAdapter,
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
  connected: string;
  notConnected: string;
  threads: string;
  newThread: string;
  currentThread: string;
  emptyTitle: string;
  emptyBody: string;
  promptLabel: string;
  suggestions: string[];
  inputLabel: string;
  inputPlaceholder: string;
  send: string;
  voiceInput: string;
  stopVoiceInput: string;
  voiceInputNotice: string;
  voiceUnsupported: string;
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
  const [threadKey, setThreadKey] = React.useState(0);
  const voiceSupported = WebSpeechDictationAdapter.isSupported();
  const startNewThread = () => setThreadKey((key) => key + 1);

  return (
    <main
      className="assistant-chat"
      aria-label="Assistant chat"
      lang={locale}
    >
      <aside
        className="thread-sidebar"
        aria-label={labels.threads}
      >
        <div className="brand">
          <span
            className="brand-mark"
            aria-hidden="true"
          >
            &#10037;
          </span>
          <h1>Jarvas</h1>
        </div>
        <button
          className="new-thread-button"
          type="button"
          onClick={startNewThread}
        >
          <span
            className="new-thread-icon"
            aria-hidden="true"
          >
            +
          </span>
          {labels.newThread}
        </button>
        <div className="thread-list">
          <p className="sidebar-label">{labels.threads}</p>
          <div
            className="thread-row"
            aria-current="page"
          >
            <span
              className="thread-indicator"
              aria-hidden="true"
            />
            <span>{labels.currentThread}</span>
          </div>
        </div>
      </aside>
      <section
        className="chat-panel"
        aria-label="Assistant conversation"
      >
        <header className="chat-toolbar">
          <button
            className="mobile-new-thread"
            type="button"
            onClick={startNewThread}
          >
            <span aria-hidden="true">+</span>
            {labels.newThread}
          </button>
          <h2>{labels.currentThread}</h2>
          <span
            className={`connection-state${connected ? ' is-connected' : ''}`}
            aria-live="polite"
          >
            {connected ? labels.connected : labels.notConnected}
          </span>
          <slot name="return-link" />
        </header>
        <Conversation
          key={threadKey}
          connected={connected}
          adapter={adapter}
          labels={labels}
          locale={locale}
          voiceSupported={voiceSupported}
        />
      </section>
    </main>
  );
}

function Conversation({
  connected,
  adapter,
  labels,
  locale,
  voiceSupported,
}: {
  connected: boolean;
  adapter: ChatModelAdapter;
  labels: ChatLabels;
  locale: string;
  voiceSupported: boolean;
}) {
  const dictationAdapter = React.useMemo(
    () =>
      voiceSupported ? new WebSpeechDictationAdapter({ language: locale }) : undefined,
    [locale, voiceSupported],
  );
  const runtime = useLocalRuntime(adapter, {
    adapters: { dictation: dictationAdapter },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport
          className="thread-viewport"
          turnAnchor="top"
        >
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <EmptyThread
              connected={connected}
              labels={labels}
              voiceSupported={voiceSupported}
            />
          </AuiIf>
          <AuiIf condition={(state) => !state.thread.isEmpty}>
            <>
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
                <Composer
                  connected={connected}
                  labels={labels}
                  voiceSupported={voiceSupported}
                />
              </ThreadPrimitive.ViewportFooter>
            </>
          </AuiIf>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function EmptyThread({
  connected,
  labels,
  voiceSupported,
}: {
  connected: boolean;
  labels: ChatLabels;
  voiceSupported: boolean;
}) {
  const composer = unstable_useComposerInput({ disabled: !connected });

  return (
    <div className="empty-thread">
      <div className="empty-heading">
        <h3>{labels.emptyTitle}</h3>
        <p>{labels.emptyBody}</p>
      </div>
      <Composer
        connected={connected}
        labels={labels}
        voiceSupported={voiceSupported}
      />
      <div
        className="prompt-list"
        role="group"
        aria-label={labels.promptLabel}
      >
        {labels.suggestions.map((suggestion) => (
          <button
            className="prompt-button"
            key={suggestion}
            type="button"
            disabled={!connected}
            onClick={() => composer.setText(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  connected,
  labels,
  voiceSupported,
}: {
  connected: boolean;
  labels: ChatLabels;
  voiceSupported: boolean;
}) {
  return (
    <ComposerPrimitive.Root className="composer">
      <ComposerPrimitive.Input
        aria-label={labels.inputLabel}
        placeholder={labels.inputPlaceholder}
        className="composer-input"
        rows={1}
        disabled={!connected}
      />
      <AuiIf condition={(state) => state.composer.dictation == null}>
        <ComposerPrimitive.Dictate
          className="voice-button"
          aria-label={labels.voiceInput}
          aria-description={labels.voiceInputNotice}
          title={voiceSupported ? labels.voiceInputNotice : labels.voiceUnsupported}
          disabled={!connected || !voiceSupported}
        >
          <MicrophoneIcon />
        </ComposerPrimitive.Dictate>
      </AuiIf>
      <AuiIf condition={(state) => state.composer.dictation != null}>
        <ComposerPrimitive.StopDictation
          className="voice-button is-listening"
          aria-label={labels.stopVoiceInput}
          title={labels.stopVoiceInput}
        >
          <span
            className="stop-dictation-icon"
            aria-hidden="true"
          />
        </ComposerPrimitive.StopDictation>
      </AuiIf>
      <ComposerPrimitive.Send
        className="send-button"
        disabled={!connected}
        aria-label={labels.send}
      >
        &#8593;
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

function MicrophoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      focusable="false"
    >
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
      />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8" />
    </svg>
  );
}

const DEFAULT_LABELS: ChatLabels = {
  connected: 'Connected',
  notConnected: 'Not connected',
  threads: 'Threads',
  newThread: 'New thread',
  currentThread: 'New chat',
  emptyTitle: 'How can I help you today?',
  emptyBody: 'Your tasks and plans will be ready to discuss here.',
  promptLabel: 'Try one of these prompts',
  suggestions: [
    'Plan my day',
    'Break down a task',
    'Help me prioritize',
    'Capture a task',
  ],
  inputLabel: 'Message your assistant',
  inputPlaceholder: 'Send a message...',
  send: 'Send message',
  voiceInput: 'Start voice input',
  stopVoiceInput: 'Stop voice input',
  voiceInputNotice: 'Speech recognition may process audio using your browser service.',
  voiceUnsupported: 'Voice input is not supported in this browser',
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
