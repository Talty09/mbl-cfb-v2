import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { CURRENT_SEASON, ChatMessage, avatarColor, initials } from '../../core/models';

/**
 * Trash Talk: league group chat. History via GET /api/chat/:year, posts via
 * POST /api/chat/:year (auth required).
 *
 * Freshness comes from polling, not a socket: socket.io cannot run on Workers,
 * and cross-client fanout there would require Durable Objects (a paid feature)
 * for a chat that eleven friends use. Polling is gated on tab visibility so a
 * backgrounded tab costs nothing against the free plan's request budget.
 *
 * TODO(phase 6): move to the shared `/api/pulse` change-detector and the
 * `?since=<id>` cursor so this refetches only when there is something new,
 * and drop the local ChatMessage model in favour of `shared`.
 */
@Component({
  selector: 'app-trash-talk-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './trash-talk.page.html',
  styleUrl: './trash-talk.page.scss',
})
export class TrashTalkPage implements OnDestroy {
  private http = inject(HttpClient);
  protected auth = inject(AuthService);

  protected readonly messages = signal<ChatMessage[]>([]);
  protected draft = '';
  protected readonly sending = signal(false);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  private readonly document = inject(DOCUMENT);
  private timer: ReturnType<typeof setInterval> | undefined;

  /** Chat is the most latency-sensitive read view, so it polls faster than the rest. */
  private static readonly POLL_MS = 8_000;

  constructor() {
    void this.refresh();
    this.timer = setInterval(() => {
      if (this.document.visibilityState === 'visible') void this.refresh();
    }, TrashTalkPage.POLL_MS);
  }

  private async refresh(): Promise<void> {
    const history = await firstValueFrom(
      this.http.get<ChatMessage[]>(`/api/chat/${CURRENT_SEASON}`),
    );
    this.messages.set(history);
  }

  protected async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    try {
      await firstValueFrom(this.http.post(`/api/chat/${CURRENT_SEASON}`, { body }));
      this.draft = '';
      // Without a broadcast to echo the message back, refresh so the sender
      // sees their own post immediately rather than on the next tick.
      await this.refresh();
    } finally {
      this.sending.set(false);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
