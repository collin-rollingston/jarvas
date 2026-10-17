import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  AuiIf,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  SimpleImageAttachmentAdapter,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  createSimpleTitleAdapter,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  useAuiState,
  useAui,
  type Attachment,
  type AttachmentAdapter,
  type CompleteAttachment,
  type ChatModelAdapter,
  type ImageMessagePartProps,
  type PendingAttachment,
  type ThreadMessage,
  type TextMessagePartProps,
  type TitleGenerationAdapter,
} from '@assistant-ui/react';
import { createLocalStorageAdapter } from '@assistant-ui/core/react';
import { marked } from 'marked';
import styles from './style.css?inline';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  images?: { dataUrl: string; filename: string }[];
};

type AgentAdapter = {
  run(input: {
    messages: readonly ChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
  transcribeAudio(input: { audio: Uint8Array }): Promise<string>;
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
  voiceRequestingPermission: string;
  voiceRecording: string;
  voiceTranscribing: string;
  voiceNoAudio: string;
  voicePermissionDenied: string;
  voiceMicrophoneMissing: string;
  voiceRecordingFailed: string;
  voiceTranscriptionFailed: string;
  addImages: string;
  imageUploadNotice: string;
  imageUploadTooLarge: string;
  imageUploadUnsupported: string;
  imageUploadLimit: string;
  imageUploadFailed: string;
  removeAttachment: string;
  attachedImage: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES_PER_MESSAGE = 12 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGES_PER_REQUEST = 4;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

class LimitedImageAttachmentAdapter implements AttachmentAdapter {
  readonly accept = 'image/png,image/jpeg,image/webp,image/gif';
  private readonly _adapter = new SimpleImageAttachmentAdapter();

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (!IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
      throw new Error('Unsupported image type.');
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image is empty or too large.');
    }
    return this._adapter.add({ file });
  }

  async send(
    attachment: PendingAttachment,
    options?: { signal?: AbortSignal },
  ): Promise<CompleteAttachment> {
    const complete = await this._adapter.send(attachment, options);
    return {
      ...complete,
      content: complete.content.map((part) =>
        part.type === 'image' ? { ...part, filename: attachment.name } : part,
      ),
    };
  }

  async remove(_attachment: Attachment): Promise<void> {
    await this._adapter.remove();
  }
}

const imageAttachmentAdapter = new LimitedImageAttachmentAdapter();

const CHAT_DB_NAME = 'jarvas-assistant-chat';
const CHAT_DB_VERSION = 1;
const CHAT_STORE_NAME = 'key-value';
let chatDbPromise: Promise<IDBDatabase> | undefined;

const openChatDatabase = (): Promise<IDBDatabase> => {
  if (chatDbPromise) return chatDbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CHAT_STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Assistant chat storage is blocked'));
  });
  const pending = opening.catch((error: unknown) => {
    chatDbPromise = undefined;
    throw error;
  });
  chatDbPromise = pending;
  return pending;
};

const assistantChatStorage = {
  async getItem(key: string): Promise<string | null> {
    const database = await openChatDatabase();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(CHAT_STORE_NAME, 'readonly')
        .objectStore(CHAT_STORE_NAME)
        .get(key);
      request.onsuccess = () =>
        resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  },
  async setItem(key: string, value: string): Promise<void> {
    const database = await openChatDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CHAT_STORE_NAME, 'readwrite');
      transaction.objectStore(CHAT_STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async removeItem(key: string): Promise<void> {
    const database = await openChatDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(CHAT_STORE_NAME, 'readwrite');
      transaction.objectStore(CHAT_STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  },
};

const simpleTitleAdapter = createSimpleTitleAdapter();
const imageAwareTitleAdapter: TitleGenerationAdapter = {
  async generateTitle(messages: readonly ThreadMessage[]): Promise<string> {
    const simpleTitle = await simpleTitleAdapter.generateTitle(messages);
    if (simpleTitle !== 'New Thread') return simpleTitle;
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const image = firstUserMessage?.content.find((part) => part.type === 'image');
    if (image?.type !== 'image') return simpleTitle;
    const filename = image.filename?.trim();
    if (!filename) return 'Image discussion';
    return filename.length > 50 ? `${filename.slice(0, 47)}...` : filename;
  },
};

const localThreadListAdapter = createLocalStorageAdapter({
  storage: assistantChatStorage,
  prefix: 'jarvas:assistant-chat:',
  titleGenerator: imageAwareTitleAdapter,
});

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
  agentAdapter,
}: {
  connected: boolean;
  adapter: ChatModelAdapter;
  agentAdapter: AgentAdapter | null;
  labels: ChatLabels;
  locale: string;
}) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useLocalRuntime(adapter, {
        adapters: { attachments: imageAttachmentAdapter },
      }),
    adapter: localThreadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatLayout
        connected={connected}
        labels={labels}
        locale={locale}
        agentAdapter={agentAdapter}
      />
    </AssistantRuntimeProvider>
  );
}

function ChatLayout({
  connected,
  labels,
  locale,
  agentAdapter,
}: {
  connected: boolean;
  labels: ChatLabels;
  locale: string;
  agentAdapter: AgentAdapter | null;
}) {
  const currentTitle = useAuiState(
    (state) =>
      state.threads.threadItems.find((item) => item.id === state.threads.mainThreadId)
        ?.title,
  );

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
        <ThreadListPrimitive.New className="new-thread-button">
          <span
            className="new-thread-icon"
            aria-hidden="true"
          >
            +
          </span>
          {labels.newThread}
        </ThreadListPrimitive.New>
        <ThreadListPrimitive.Root className="thread-list">
          <p className="sidebar-label">{labels.threads}</p>
          <ThreadListPrimitive.Items>
            {({ threadListItem }) =>
              threadListItem.title ? (
                <ThreadListItemPrimitive.Root
                  className="thread-list-item"
                  key={threadListItem.id}
                >
                  <ThreadListItemPrimitive.Trigger
                    className="thread-row"
                    type="button"
                    aria-label={threadListItem.title}
                  >
                    <span
                      className="thread-indicator"
                      aria-hidden="true"
                    />
                    <span className="thread-title">
                      <ThreadListItemPrimitive.Title />
                    </span>
                  </ThreadListItemPrimitive.Trigger>
                </ThreadListItemPrimitive.Root>
              ) : null
            }
          </ThreadListPrimitive.Items>
        </ThreadListPrimitive.Root>
      </aside>
      <section
        className="chat-panel"
        aria-label="Assistant conversation"
      >
        <header className="chat-toolbar">
          <ThreadListPrimitive.New className="mobile-new-thread">
            <span aria-hidden="true">+</span>
            {labels.newThread}
          </ThreadListPrimitive.New>
          <h2>{currentTitle || labels.emptyTitle}</h2>
          <span
            className={`connection-state${connected ? ' is-connected' : ''}`}
            aria-live="polite"
          >
            {connected ? labels.connected : labels.notConnected}
          </span>
          <slot name="return-link" />
        </header>
        <Conversation
          connected={connected}
          labels={labels}
          agentAdapter={agentAdapter}
        />
      </section>
    </main>
  );
}

function Conversation({
  connected,
  labels,
  agentAdapter,
}: {
  connected: boolean;
  labels: ChatLabels;
  agentAdapter: AgentAdapter | null;
}) {
  return (
    <ThreadPrimitive.Root className="thread-root">
      <AuiIf condition={(state) => state.thread.isEmpty}>
        <ThreadPrimitive.Viewport
          className="thread-viewport empty-thread-viewport"
          turnAnchor="top"
        >
          <EmptyThread
            connected={connected}
            labels={labels}
            agentAdapter={agentAdapter}
          />
        </ThreadPrimitive.Viewport>
      </AuiIf>
      <AuiIf condition={(state) => !state.thread.isEmpty}>
        <>
          <ThreadPrimitive.Viewport
            className="thread-viewport conversation-viewport"
            turnAnchor="top"
          >
            <div className="message-list">
              <ThreadPrimitive.Messages>
                {({ message }) => (
                  <MessagePrimitive.Root
                    className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
                  >
                    <MessagePrimitive.Parts
                      components={{
                        Text: MarkdownMessagePart,
                        Image: ({ image, filename }: ImageMessagePartProps) => (
                          <img
                            className="message-image"
                            src={image}
                            alt={filename || labels.attachedImage}
                            loading="lazy"
                          />
                        ),
                      }}
                    />
                  </MessagePrimitive.Root>
                )}
              </ThreadPrimitive.Messages>
            </div>
          </ThreadPrimitive.Viewport>
          <div className="composer-dock">
            <Composer
              connected={connected}
              labels={labels}
              agentAdapter={agentAdapter}
            />
          </div>
        </>
      </AuiIf>
    </ThreadPrimitive.Root>
  );
}

const MARKDOWN_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]);

const DROP_CONTENT_TAGS = new Set([
  'audio',
  'button',
  'form',
  'iframe',
  'img',
  'input',
  'math',
  'object',
  'script',
  'select',
  'style',
  'svg',
  'textarea',
  'video',
]);

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const renderMarkdownNode = (node: Node, key: string): React.ReactNode => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (DROP_CONTENT_TAGS.has(tag)) return null;
  const children = Array.from(element.childNodes).map((child, index) => (
    <React.Fragment key={`${key}-${index}`}>
      {renderMarkdownNode(child, `${key}-${index}`)}
    </React.Fragment>
  ));

  if (!MARKDOWN_TAGS.has(tag)) return children;
  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (!href) return children;
    try {
      const url = new URL(href, window.location.href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return children;
      return (
        <a
          key={key}
          href={url.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    } catch {
      return children;
    }
  }

  const props: { key: string; start?: number; className?: string } = { key };
  if (tag === 'ol') {
    const start = Number(element.getAttribute('start'));
    if (Number.isSafeInteger(start) && start > 1) props.start = start;
  }
  if (tag === 'code') {
    const languageClass = Array.from(element.classList).find((className) =>
      /^language-[\w+-]+$/.test(className),
    );
    if (languageClass) props.className = languageClass;
  }
  return React.createElement(tag, props, ...children);
};

const MarkdownMessagePart = ({
  text,
  status,
}: TextMessagePartProps): React.ReactElement => {
  const renderedMarkdown = React.useMemo(() => {
    const renderer = new marked.Renderer();
    renderer.html = ({ text: rawHtml }) => escapeHtml(rawHtml);
    return marked.parse(text, { async: false, gfm: true, renderer });
  }, [text]);
  const content = React.useMemo(() => {
    const parsed = new DOMParser().parseFromString(renderedMarkdown, 'text/html');
    return Array.from(parsed.body.childNodes).map((node, index) => (
      <React.Fragment key={index}>
        {renderMarkdownNode(node, String(index))}
      </React.Fragment>
    ));
  }, [renderedMarkdown]);

  return (
    <div className="message-markdown">
      {content}
      {status.type === 'running' && (
        <span
          className="response-indicator"
          role="status"
          aria-label="Jarvas is responding"
        >
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  );
};

function EmptyThread({
  connected,
  labels,
  agentAdapter,
}: {
  connected: boolean;
  labels: ChatLabels;
  agentAdapter: AgentAdapter | null;
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
        agentAdapter={agentAdapter}
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

type VoiceStatus = 'requesting' | 'recording' | 'transcribing' | null;

const MAX_RECORDING_DURATION_MS = 2 * 60 * 1000;
const MAX_RECORDING_BYTES = 8 * 1024 * 1024;

const stopMediaStream = (stream: MediaStream | null): void => {
  stream?.getTracks().forEach((track) => track.stop());
};

function Composer({
  connected,
  labels,
  agentAdapter,
}: {
  connected: boolean;
  labels: ChatLabels;
  agentAdapter: AgentAdapter | null;
}) {
  const aui = useAui();
  const composer = unstable_useComposerInput({ disabled: !connected });
  const composerRef = React.useRef(composer);
  composerRef.current = composer;
  const attachments = useAuiState((state) => state.composer.attachments);
  const [voiceStatus, setVoiceStatus] = React.useState<VoiceStatus>(null);
  const [voiceError, setVoiceError] = React.useState('');
  const [imageUploadError, setImageUploadError] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const mountedRef = React.useRef(true);
  const skipTranscriptionRef = React.useRef(false);
  const recordingTimeoutRef = React.useRef<number | undefined>(undefined);

  const handleImagesSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    setImageUploadError('');

    let imageCount = attachments.filter(
      (attachment) => attachment.type === 'image',
    ).length;
    let totalImageBytes = attachments.reduce(
      (total, attachment) =>
        total + (attachment.type === 'image' ? (attachment.file?.size ?? 0) : 0),
      0,
    );

    for (const selectedFile of selectedFiles) {
      const extension = selectedFile.name.split('.').pop()?.toLowerCase() ?? '';
      const mimeType =
        selectedFile.type.toLowerCase() || IMAGE_MIME_BY_EXTENSION[extension];
      if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) {
        setImageUploadError(labels.imageUploadUnsupported);
        continue;
      }
      if (selectedFile.size === 0 || selectedFile.size > MAX_IMAGE_BYTES) {
        setImageUploadError(labels.imageUploadTooLarge);
        continue;
      }
      if (imageCount >= MAX_IMAGES_PER_MESSAGE) {
        setImageUploadError(labels.imageUploadLimit);
        break;
      }
      if (totalImageBytes + selectedFile.size > MAX_IMAGE_BYTES_PER_MESSAGE) {
        setImageUploadError(labels.imageUploadLimit);
        continue;
      }

      const file =
        selectedFile.type === mimeType
          ? selectedFile
          : new File([selectedFile], selectedFile.name, {
              type: mimeType,
              lastModified: selectedFile.lastModified,
            });
      try {
        await aui.composer.addAttachment(file);
        imageCount++;
        totalImageBytes += file.size;
      } catch {
        setImageUploadError(labels.imageUploadFailed);
      }
    }
  };

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recordingTimeoutRef.current !== undefined) {
        window.clearTimeout(recordingTimeoutRef.current);
      }
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.onerror = null;
        try {
          recorder.stop();
        } catch {
          // The stream is still stopped below if recording already ended.
        }
      }
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  const handleStopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    if (recordingTimeoutRef.current !== undefined) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = undefined;
    }
    setVoiceStatus('transcribing');
    recorder.stop();
  };

  const handleStartRecording = async () => {
    if (!connected || !agentAdapter || voiceStatus !== null) return;
    setVoiceError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError(labels.voiceUnsupported);
      return;
    }

    setVoiceStatus('requesting');
    let acquiredStream: MediaStream | null = null;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stopMediaStream(acquiredStream);
        return;
      }

      const supportedMimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = supportedMimeType
        ? new MediaRecorder(acquiredStream, { mimeType: supportedMimeType })
        : new MediaRecorder(acquiredStream);

      streamRef.current = acquiredStream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      skipTranscriptionRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        skipTranscriptionRef.current = true;
        if (recordingTimeoutRef.current !== undefined) {
          window.clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = undefined;
        }
        stopMediaStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        if (mountedRef.current) {
          setVoiceStatus(null);
          setVoiceError(labels.voiceRecordingFailed);
        }
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current !== undefined) {
          window.clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = undefined;
        }
        stopMediaStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        if (skipTranscriptionRef.current) return;

        const recording = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];
        if (!mountedRef.current) return;
        if (recording.size === 0) {
          setVoiceStatus(null);
          setVoiceError(labels.voiceNoAudio);
          return;
        }
        if (recording.size > MAX_RECORDING_BYTES) {
          setVoiceStatus(null);
          setVoiceError(labels.voiceRecordingFailed);
          return;
        }

        setVoiceStatus('transcribing');
        void recording
          .arrayBuffer()
          .then((buffer) =>
            agentAdapter.transcribeAudio({ audio: new Uint8Array(buffer) }),
          )
          .then((transcript) => {
            if (!mountedRef.current) return;
            const text = transcript.trim();
            if (!text) {
              setVoiceError(labels.voiceNoAudio);
              return;
            }
            const existingText = composerRef.current.value.trimEnd();
            composerRef.current.setText(existingText ? existingText + ' ' + text : text);
            setVoiceError('');
          })
          .catch(() => {
            if (mountedRef.current) setVoiceError(labels.voiceTranscriptionFailed);
          })
          .finally(() => {
            if (mountedRef.current) setVoiceStatus(null);
          });
      };
      recorder.start(1000);
      setVoiceStatus('recording');
      recordingTimeoutRef.current = window.setTimeout(
        handleStopRecording,
        MAX_RECORDING_DURATION_MS,
      );
    } catch (error) {
      stopMediaStream(acquiredStream);
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
      if (!mountedRef.current) return;
      setVoiceStatus(null);
      const errorName =
        error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        setVoiceError(labels.voicePermissionDenied);
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setVoiceError(labels.voiceMicrophoneMissing);
      } else {
        setVoiceError(labels.voiceRecordingFailed);
      }
    }
  };

  const isRecording = voiceStatus === 'recording';
  const isBusy = voiceStatus === 'requesting' || voiceStatus === 'transcribing';
  const voiceStatusText =
    voiceStatus === 'requesting'
      ? labels.voiceRequestingPermission
      : voiceStatus === 'recording'
        ? labels.voiceRecording
        : voiceStatus === 'transcribing'
          ? labels.voiceTranscribing
          : '';

  return (
    <div className="composer-shell">
      <ComposerPrimitive.Root className="composer">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            <ComposerPrimitive.Attachments>
              {({ attachment }) => (
                <ComposerAttachmentPreview
                  key={attachment.id}
                  attachment={attachment}
                  labels={labels}
                />
              )}
            </ComposerPrimitive.Attachments>
          </div>
        )}
        <div className="composer-controls">
          <button
            className="attachment-button"
            type="button"
            aria-label={labels.addImages}
            aria-description={labels.imageUploadNotice}
            title={labels.imageUploadNotice}
            disabled={
              !connected ||
              !agentAdapter ||
              attachments.filter((attachment) => attachment.type === 'image').length >=
                MAX_IMAGES_PER_MESSAGE
            }
            onClick={() => fileInputRef.current?.click()}
          >
            <AddImageIcon />
          </button>
          <input
            ref={fileInputRef}
            className="composer-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            aria-label={labels.addImages}
            onChange={(event) => void handleImagesSelected(event)}
          />
          <ComposerPrimitive.Input
            aria-label={labels.inputLabel}
            placeholder={labels.inputPlaceholder}
            className="composer-input"
            data-assistant-chat-composer=""
            rows={1}
            disabled={!connected}
          />
          <button
            className={`voice-button${isRecording ? ' is-listening' : ''}${isBusy ? ' is-busy' : ''}`}
            type="button"
            aria-label={isRecording ? labels.stopVoiceInput : labels.voiceInput}
            aria-description={labels.voiceInputNotice}
            aria-pressed={isRecording}
            title={
              isRecording
                ? labels.stopVoiceInput
                : isBusy
                  ? voiceStatusText
                  : labels.voiceInputNotice
            }
            disabled={!connected || !agentAdapter || isBusy}
            onClick={isRecording ? handleStopRecording : handleStartRecording}
          >
            {isBusy ? (
              <span
                className="voice-spinner"
                aria-hidden="true"
              />
            ) : isRecording ? (
              <span
                className="stop-dictation-icon"
                aria-hidden="true"
              />
            ) : (
              <MicrophoneIcon />
            )}
          </button>
          <ComposerPrimitive.Send
            className="send-button"
            disabled={!connected}
            aria-label={labels.send}
          >
            &#8593;
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
      {imageUploadError && (
        <p
          className="voice-status is-error"
          role="alert"
        >
          {imageUploadError}
        </p>
      )}
      {voiceStatusText && (
        <p
          className="voice-status"
          role="status"
          aria-live="polite"
        >
          {voiceStatusText}
        </p>
      )}
      {voiceError && (
        <p
          className="voice-status is-error"
          role="alert"
        >
          {voiceError}
        </p>
      )}
    </div>
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

function AddImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ComposerAttachmentPreview({
  attachment,
  labels,
}: {
  attachment: Attachment;
  labels: ChatLabels;
}) {
  const [previewUrl, setPreviewUrl] = React.useState('');

  React.useEffect(() => {
    if (attachment.type !== 'image' || !attachment.file) return;
    const url = URL.createObjectURL(attachment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment.file, attachment.type]);

  return (
    <AttachmentPrimitive.Root className="composer-attachment">
      <span
        className="composer-attachment-thumb"
        aria-hidden="true"
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
          />
        ) : (
          <span>IMG</span>
        )}
      </span>
      <span
        className="composer-attachment-name"
        title={attachment.name}
      >
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove
        className="attachment-remove-button"
        type="button"
        aria-label={`${labels.removeAttachment}: ${attachment.name}`}
        title={labels.removeAttachment}
      >
        <span aria-hidden="true">×</span>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
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
  voiceInput: 'Start voice recording',
  stopVoiceInput: 'Stop recording and transcribe',
  voiceInputNotice:
    'Recordings are sent to Cloudflare Workers AI for transcription when you stop. Maximum length: 2 minutes.',
  voiceUnsupported: 'Voice recording is not available in this browser.',
  voiceRequestingPermission: 'Requesting microphone access…',
  voiceRecording: 'Recording. Tap the microphone again to stop and transcribe.',
  voiceTranscribing: 'Transcribing your recording…',
  voiceNoAudio: 'No speech was transcribed. Try again and speak after recording starts.',
  voicePermissionDenied:
    'Microphone access was denied. Allow microphone access and try again.',
  voiceMicrophoneMissing: 'No microphone was found.',
  voiceRecordingFailed: 'Recording failed. Check microphone access and try again.',
  voiceTranscriptionFailed: 'Transcription failed. Check your connection and try again.',
  addImages: 'Add images',
  imageUploadNotice:
    'Images are sent to Cloudflare Workers AI when you send your message. Up to 3 images, 5 MB each.',
  imageUploadTooLarge: 'Each image must be 5 MB or smaller.',
  imageUploadUnsupported: 'Choose a PNG, JPG, WebP, or GIF image.',
  imageUploadLimit: 'Attach up to 3 images with a combined size of 12 MB per message.',
  imageUploadFailed: 'Could not add that image. Try another file.',
  removeAttachment: 'Remove image',
  attachedImage: 'Attached image',
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
        agentAdapter={this._agentAdapter}
        labels={this._labels ?? DEFAULT_LABELS}
        locale={this._locale}
      />,
    );
  }
}

function createAgentAdapter(agentAdapter: AgentAdapter): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const conversationMessages = messages.flatMap((message): ChatMessage[] => {
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        const content = message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n');
        const images =
          message.role === 'user'
            ? message.content.flatMap((part) =>
                part.type === 'image'
                  ? [
                      {
                        dataUrl: part.image,
                        filename: part.filename ?? 'image',
                      },
                    ]
                  : [],
              )
            : [];
        if (!content && !images.length) return [];
        return [
          {
            role: message.role,
            content,
            ...(images.length ? { images } : {}),
          },
        ];
      });
      let remainingImages = MAX_IMAGES_PER_REQUEST;
      const requestMessages = conversationMessages.map((message) => ({ ...message }));
      for (let index = requestMessages.length - 1; index >= 0; index--) {
        const message = requestMessages[index];
        if (!message.images?.length) continue;
        const recentImages = remainingImages
          ? message.images.slice(-remainingImages)
          : [];
        remainingImages -= recentImages.length;
        requestMessages[index] = {
          ...message,
          images: recentImages,
        };
      }
      const boundedMessages = requestMessages.filter(
        (message) => message.content || message.images?.length,
      );
      let text = '';
      for await (const chunk of agentAdapter.run({
        messages: boundedMessages,
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
