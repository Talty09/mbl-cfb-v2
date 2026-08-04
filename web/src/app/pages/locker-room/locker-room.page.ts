import { Component, computed, effect, inject, signal } from '@angular/core';
import { DRAFT_ROUNDS, type RosterCard } from 'shared';
import { ApiService } from '../../core/api.service';
import { PulseService } from '../../core/pulse.service';
import { avatarColor, initials } from '../../core/models';

@Component({
  selector: 'app-locker-room-page',
  templateUrl: './locker-room.page.html',
  styleUrl: './locker-room.page.scss',
})
export class LockerRoomPage {
  private api = inject(ApiService);
  private pulse = inject(PulseService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;
  protected readonly rounds = DRAFT_ROUNDS;

  private readonly cards = signal<RosterCard[]>([]);
  /** Separates "still loading" from "the league is genuinely empty". */
  protected readonly loaded = signal(false);

  /**
   * Leaderboard order, like the standings and the design mock. Before anyone has
   * scored every total is 0, so the name tiebreak is what actually orders the
   * grid for most of the preseason — which is why it isn't just decoration.
   */
  protected readonly rosters = computed(() =>
    [...this.cards()].sort(
      (a, b) => b.total - a.total || a.user.displayName.localeCompare(b.user.displayName),
    ),
  );

  constructor() {
    // Two counters move a roster card: a pick changes who owns what, and an
    // ingest changes what those teams have earned.
    effect(() => {
      this.pulse.pickCount();
      this.pulse.lastSyncAt();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.cards.set(await this.api.rosters());
    } catch {
      // Keep the last good grid; the next pulse tick retries.
    } finally {
      this.loaded.set(true);
    }
  }

  /** Teams a manager still has coming, so a half-finished draft reads as such. */
  protected picksRemaining(card: RosterCard): number {
    return Math.max(0, DRAFT_ROUNDS - card.teams.length);
  }

  /**
   * Ranked teams first, then alphabetical. `/api/rosters` groups by team id and
   * so has no meaningful order of its own; this at least makes the chips stable
   * between loads and leads with the names people look for.
   */
  protected orderedTeams(card: RosterCard): RosterCard['teams'] {
    return [...card.teams].sort(
      (a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.school.localeCompare(b.school),
    );
  }
}
