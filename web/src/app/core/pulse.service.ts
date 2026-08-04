import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import type { Pulse } from 'shared';
import { ApiService } from './api.service';

/**
 * Freshness for the whole app, without a realtime channel.
 *
 * The app has no WebSocket: socket.io cannot run on Workers, and cross-client
 * fanout there would need Durable Objects, which are a paid feature — for an
 * eleven-person league with an asynchronous multi-day draft, polling is the
 * right answer rather than a compromise.
 *
 * Two things keep it cheap against the free plan's 100k requests/day:
 *
 * 1. Only ONE endpoint is polled. `/api/pulse` returns nothing but change
 *    counters, so a tick costs a single small request no matter which view is
 *    open. Views watch the counter they care about and refetch the real resource
 *    only when it moves.
 * 2. Polling is gated on tab visibility, so a backgrounded tab costs nothing.
 *
 * Cadence follows the route rather than being set by each page, so a page that
 * forgets to reset it cannot leave the whole app polling fast.
 */
@Injectable({ providedIn: 'root' })
export class PulseService {
  private api = inject(ApiService);
  private router = inject(Router);
  private document = inject(DOCUMENT);
  private destroyRef = inject(DestroyRef);

  /** Views where someone is actively waiting on someone else's action. */
  private static readonly ACTIVE_MS = 8_000;
  private static readonly IDLE_MS = 30_000;
  private static readonly ACTIVE_ROUTES = ['/draft-room', '/trash-talk'];

  private readonly latest = signal<Pulse | null>(null);

  /** Bumps on every pick. Draft Room refetches when it changes. */
  readonly pickCount = signal(0);
  /** Max chat id. Trash Talk fetches `?since=` this value. */
  readonly lastChatId = signal(0);
  /** Bumps when the ingest writes anything. Scoring views refetch. */
  readonly lastSyncAt = signal<number | null>(null);
  readonly currentWeek = signal<number | null>(null);
  readonly draftStatus = signal<Pulse['draftStatus']>('pending');
  readonly onlineCount = signal(0);

  private timer: ReturnType<typeof setInterval> | undefined;
  private cadence = PulseService.IDLE_MS;
  private started = false;

  /**
   * Begin polling. Called once from the app shell; safe to call again.
   *
   * Deliberately not started in the constructor — a root service constructed
   * during app initialization should not kick off network traffic as a side
   * effect of being injected.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.applyCadence(this.router.url);

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.applyCadence(event.urlAfterRedirects);
        // Navigating is a strong signal the user wants current data.
        void this.tick();
      });

    // A tab returning to the foreground may have missed many ticks.
    const onVisible = () => {
      if (this.document.visibilityState === 'visible') void this.tick();
    };
    this.document.addEventListener('visibilitychange', onVisible);

    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      if (this.timer) clearInterval(this.timer);
    });

    void this.tick();
  }

  /** Force a refresh — used right after a write, so the UI reflects it at once. */
  async refresh(): Promise<void> {
    await this.tick();
  }

  private applyCadence(url: string): void {
    const next = PulseService.ACTIVE_ROUTES.some((route) => url.startsWith(route))
      ? PulseService.ACTIVE_MS
      : PulseService.IDLE_MS;

    if (next === this.cadence && this.timer) return;

    this.cadence = next;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.document.visibilityState === 'visible') void this.tick();
    }, this.cadence);
  }

  private async tick(): Promise<void> {
    try {
      const pulse = await this.api.pulse();
      this.latest.set(pulse);
      this.pickCount.set(pulse.pickCount);
      this.lastChatId.set(pulse.lastChatId);
      this.lastSyncAt.set(pulse.lastSyncAt);
      this.currentWeek.set(pulse.currentWeek);
      this.draftStatus.set(pulse.draftStatus);
      this.onlineCount.set(pulse.onlineCount);
    } catch {
      // A failed poll is not worth surfacing: the next tick retries, and views
      // keep showing the last good data rather than an error state.
    }
  }
}
