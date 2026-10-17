import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  InjectionToken,
  signal,
  ViewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { AssistantChatAdapter } from './assistant-chat.model';

interface AssistantChatLabels {
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
}

interface AssistantChatElement extends HTMLElement {
  configure(config: {
    agentAdapter: AssistantChatAdapter | null;
    locale: string;
    labels: AssistantChatLabels;
  }): void;
}

export const ASSISTANT_CHAT_ADAPTER = new InjectionToken<AssistantChatAdapter | null>(
  'ASSISTANT_CHAT_ADAPTER',
  { providedIn: 'root', factory: () => null },
);

@Component({
  selector: 'assistant-chat-page',
  templateUrl: './assistant-chat.component.html',
  styleUrl: './assistant-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [RouterLink, TranslatePipe],
  standalone: true,
})
export class AssistantChatComponent implements AfterViewInit {
  private static _bundlePromise?: Promise<void>;

  readonly T = T;

  @ViewChild('chatUi', { read: ElementRef })
  private _chatUi?: ElementRef<AssistantChatElement>;

  private readonly _adapter = inject(ASSISTANT_CHAT_ADAPTER);
  private readonly _translate = inject(TranslateService);
  private readonly _document = inject(DOCUMENT);
  readonly loadError = signal('');

  async ngAfterViewInit(): Promise<void> {
    try {
      await this._loadBundle();
      const chat = this._chatUi?.nativeElement;
      if (!chat) return;
      chat.configure({
        agentAdapter: this._adapter,
        locale: this._translate.currentLang || 'en',
        labels: this._getLabels(),
      });
    } catch {
      this.loadError.set(this._translate.instant(T.AUI.LOAD_ERROR));
    }
  }

  private async _loadBundle(): Promise<void> {
    const registry = this._document.defaultView?.customElements;
    if (!registry) throw new Error('Custom elements are not available');
    if (registry.get('assistant-chat-ui')) return;

    if (!AssistantChatComponent._bundlePromise) {
      const script = this._document.createElement('script');
      script.dataset['assistantChatUi'] = 'true';
      script.src = new URL(
        'assets/bundled-plugins/assistant-chat-ui/assistant-chat-ui.js',
        this._document.baseURI,
      ).toString();
      AssistantChatComponent._bundlePromise = new Promise<void>((resolve, reject) => {
        script.addEventListener(
          'load',
          () => {
            if (registry.get('assistant-chat-ui')) {
              resolve();
            } else {
              script.remove();
              reject(new Error('Chat bundle did not register its custom element'));
            }
          },
          { once: true },
        );
        script.addEventListener(
          'error',
          () => {
            script.remove();
            reject(new Error('Chat bundle failed to load'));
          },
          { once: true },
        );
        this._document.head.append(script);
      });
    }

    try {
      await AssistantChatComponent._bundlePromise;
    } catch (error) {
      AssistantChatComponent._bundlePromise = undefined;
      throw error;
    }
  }

  private _getLabels(): AssistantChatLabels {
    return {
      connected: this._translate.instant(T.AUI.CONNECTED),
      notConnected: this._translate.instant(T.AUI.NOT_CONNECTED),
      threads: this._translate.instant(T.AUI.THREADS),
      newThread: this._translate.instant(T.AUI.NEW_THREAD),
      currentThread: this._translate.instant(T.AUI.CURRENT_THREAD),
      emptyTitle: this._translate.instant(T.AUI.EMPTY_TITLE),
      emptyBody: this._translate.instant(T.AUI.EMPTY_BODY),
      promptLabel: this._translate.instant(T.AUI.PROMPT_LABEL),
      suggestions: [
        this._translate.instant(T.AUI.SUGGESTION_PLAN_DAY),
        this._translate.instant(T.AUI.SUGGESTION_BREAK_DOWN_TASK),
        this._translate.instant(T.AUI.SUGGESTION_PRIORITIZE),
        this._translate.instant(T.AUI.SUGGESTION_CAPTURE_TASK),
      ],
      inputLabel: this._translate.instant(T.AUI.INPUT_LABEL),
      inputPlaceholder: this._translate.instant(T.AUI.INPUT_PLACEHOLDER),
      send: this._translate.instant(T.AUI.SEND),
      voiceInput: this._translate.instant(T.AUI.VOICE_INPUT),
      stopVoiceInput: this._translate.instant(T.AUI.STOP_VOICE_INPUT),
      voiceInputNotice: this._translate.instant(T.AUI.VOICE_INPUT_NOTICE),
      voiceUnsupported: this._translate.instant(T.AUI.VOICE_UNSUPPORTED),
    };
  }
}
