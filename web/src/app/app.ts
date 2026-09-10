import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Meta } from 'shared';
import { ApiService } from './core/api.service';
import { AuthService } from './core/auth.service';
import { ForcePasswordChangeComponent } from './core/force-password-change.component';
import { PulseService } from './core/pulse.service';
import { StaleChunkService } from './core/stale-chunk.service';
import { DRAFT_ROOM_ENABLED } from './core/features';
import { CURRENT_SEASON, avatarColor, initials } from './core/models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ForcePasswordChangeComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private router = inject(Router);
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected pulse = inject(PulseService);
  private staleChunks = inject(StaleChunkService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  private readonly meta = signal<Meta | null>(null);

  /** Falls back to the compile-time constant until `/api/meta` answers. */
  protected readonly season = computed(() => this.meta()?.season ?? CURRENT_SEASON);

  /**
   * "WEEK 9 · 2026" in the design. Before the opener there is no current week,
   * so the label degrades to the season alone rather than showing "WEEK null".
   */
  protected readonly weekLabel = computed(() => {
    const week = this.pulse.currentWeek() ?? this.meta()?.currentWeek;
    const season = this.season();
    if (week == null) return `${season} Season`;
    const prefix = this.meta()?.seasonType === 'postseason' ? 'Postseason' : 'Week';
    return `${prefix} ${week} · ${season}`;
  });

  /** Drives the pulsing LIVE pill — real games in progress, not decoration. */
  protected readonly isLive = computed(() => this.meta()?.hasGamesInProgress ?? false);

  /** Surfaced so a silently broken ingest is visible rather than just stale. */
  protected readonly syncError = computed(() => this.meta()?.lastSyncError ?? null);

  protected readonly tabs = [
    { path: '/scoreboard', label: 'Scoreboard' },
    { path: '/standings', label: 'Standings' },
    { path: '/past-scores', label: 'Past Scores' },
    { path: '/locker-room', label: 'Locker Room' },
    // Hidden, not deleted — see DRAFT_ROOM_ENABLED.
    ...(DRAFT_ROOM_ENABLED ? [{ path: '/draft-room', label: 'Draft Room' }] : []),
    { path: '/trash-talk', label: 'Trash Talk' },
  ];

  constructor() {
    // Before anything else: a tab left open across a deploy has stale chunk
    // names, and without this every nav click would silently do nothing.
    this.staleChunks.start();
    this.pulse.start();
    void this.loadMeta();

    // The ingest writing anything can change the week, the live flag, or the
    // error banner, so reload the shell's own data when the poller notices.
    effect(() => {
      this.pulse.lastSyncAt();
      void this.loadMeta();
    });
  }

  private async loadMeta(): Promise<void> {
    try {
      this.meta.set(await this.api.meta());
    } catch {
      // Keep the last good header rather than blanking it.
    }
  }

  protected async signOut(): Promise<void> {
    // Await the revoke so we don't navigate away while the session is still live
    // on the server.
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
