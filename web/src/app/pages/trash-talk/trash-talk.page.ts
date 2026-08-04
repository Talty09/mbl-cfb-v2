import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ChatMessageView } from 'shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PulseService } from '../../core/pulse.service';
import { avatarColor, initials } from '../../core/models';

/**
 * Trash Talk: the league group chat.
 *
 * Freshness rides on PulseService rather than a timer of its own. The poller
 * publishes the max chat id; this page fetches `?since=<what it already holds>`
 * only when that id moves past it, and appends the result. So a quiet chat costs
 * nothing beyond the shared pulse request, and a busy one transfers only the new
 * messages instead of re-downloading the scrollback every few seconds.
 */
@Component({
  selector: 'app-trash-talk-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './trash-talk.page.html',
  styleUrl: './trash-talk.page.scss',
})
export class TrashTalkPage {
  private api = inject(ApiService);
  private pulse = inject(PulseService);
  private injector = inject(Injector);
  protected auth = inject(AuthService);

  private readonly messages = signal<ChatMessageView[]>([]);
  protected draft = '';
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly loaded = signal(false);

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  /** Treat "within a bubble's height of the end" as still following along. */
  private static readonly PINNED_SLACK_PX = 60;

  /** The highest id held, i.e. the cursor sent as `?since=`. Not rendered. */
  private highestId = 0;
  private inFlight = false;
  private pinnedToBottom = true;

  /** Presentation is precomputed so timestamp formatting is not redone per render. */
  protected readonly rows = computed(() =>
    this.messages().map((message) => ({
      id: message.id,
      body: message.body,
      name: message.user.displayName,
      initials: initials(message.user.displayName),
      color: avatarColor(message.user.avatarHue),
      time: TrashTalkPage.timeLabel(message.createdAt),
    })),
  );

  /**
   * The poller owns the online count; the chat response's copy only covers the
   * moment before the first pulse tick lands.
   */
  private readonly onlineFromChat = signal(0);
  protected readonly onlineCount = computed(() => this.pulse.onlineCount() || this.onlineFromChat());

  constructor() {
    effect(() => {
      // Runs once on creation with whatever the poller has so far, which is what
      // triggers the initial load, then again on every cursor move.
      const cursor = this.pulse.lastChatId();
      void this.sync(cursor);
    });
  }

  private async sync(cursor: number): Promise<void> {
    const initial = !this.loaded();
    if (!initial && cursor <= this.highestId) return;
    // A tick can arrive while the previous request is still open; skipping keeps
    // the cursor from being used twice and the same messages appended twice.
    if (this.inFlight) return;

    this.inFlight = true;
    try {
      // No cursor on the first load: that asks for the newest page rather than
      // the beginning of the season.
      const response = await this.api.chat(initial ? undefined : this.highestId);
      this.onlineFromChat.set(response.onlineCount);
      this.absorb(response.messages, initial);
      this.loaded.set(true);
    } catch {
      // Leave `loaded` alone so a failed first load is retried on the next cursor
      // move or the next time the view is opened, rather than showing an empty
      // chat as if there were nothing to say.
    } finally {
      this.inFlight = false;
    }
  }

  private absorb(incoming: ChatMessageView[], initial: boolean): void {
    if (!initial && incoming.length === 0) return;
    const next = initial ? incoming : [...this.messages(), ...incoming];
    this.messages.set(next);
    // Both pages come back ascending by id, so the tail is the new high-water mark.
    this.highestId = next.at(-1)?.id ?? this.highestId;
    this.scrollIfFollowing();
  }

  protected async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    this.sendError.set(null);
    try {
      const posted = await this.api.postChat(body);
      this.draft = '';
      // The POST returns the created message, so the sender sees their own words
      // at once instead of waiting for a poll to bring them back.
      this.pinnedToBottom = true;
      this.absorb([posted], false);
    } catch {
      this.sendError.set('That did not send. Check your connection and try again.');
    } finally {
      this.sending.set(false);
    }
  }

  /** Keeps `pinnedToBottom` honest: reading history must not be interrupted. */
  protected onScroll(): void {
    const element = this.list()?.nativeElement;
    if (!element) return;
    const distanceFromEnd = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.pinnedToBottom = distanceFromEnd < TrashTalkPage.PINNED_SLACK_PX;
  }

  private scrollIfFollowing(): void {
    if (!this.pinnedToBottom) return;
    // The new messages have not been rendered yet, so the scroll height is still
    // the old one — wait for the render before jumping.
    afterNextRender(
      () => {
        const element = this.list()?.nativeElement;
        if (element) element.scrollTop = element.scrollHeight;
      },
      { injector: this.injector },
    );
  }

  /**
   * "Sat 1:02 PM" like the design, with the meridiem kept because a bare "1:02"
   * on a Saturday of college football is genuinely ambiguous. Anything older than
   * a week gets a date instead, since the weekday alone would be misleading.
   */
  private static timeLabel(epochMs: number): string {
    const when = new Date(epochMs);
    const weekOld = Date.now() - epochMs > 6 * 24 * 60 * 60 * 1000;
    const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const prefix = weekOld
      ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : when.toLocaleDateString(undefined, { weekday: 'short' });
    return `${prefix} ${time}`;
  }
}
