import { Component, computed, effect, inject, signal } from '@angular/core';
import type { WeekScoresResponse, WeekScoresRow } from 'shared';
import { ApiService } from '../../core/api.service';
import { avatarColor, initials } from '../../core/models';
import { PulseService } from '../../core/pulse.service';

/**
 * Past Scores: one week's table at a time, chosen from a row of week chips.
 *
 * Two requests back this view. `/api/standings` supplies the week list (its
 * `weekly` breakdown is the only place the app learns which weeks exist), and
 * `/api/weeks/:week/scores` supplies the selected week's rows already ordered
 * and ranked — ties share a rank there, and nothing is re-ranked here.
 */
@Component({
  selector: 'app-past-scores-page',
  templateUrl: './past-scores.page.html',
  styleUrl: './past-scores.page.scss',
})
export class PastScoresPage {
  private api = inject(ApiService);
  private pulse = inject(PulseService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  protected readonly weeks = signal<number[]>([]);
  protected readonly selectedWeek = signal<number | null>(null);
  private readonly scores = signal<WeekScoresResponse | null>(null);
  protected readonly season = signal<number | null>(null);
  /** False until the week list settles, to tell "no weeks" from "not yet". */
  protected readonly loaded = signal(false);

  constructor() {
    effect(() => {
      this.pulse.lastSyncAt();
      void this.loadWeeks();
    });

    // Separate from the week list so clicking a chip refetches without also
    // re-deriving the chips underneath the click.
    effect(() => {
      const week = this.selectedWeek();
      this.pulse.lastSyncAt();
      if (week === null) {
        this.scores.set(null);
        return;
      }
      void this.loadScores(week);
    });
  }

  private async loadWeeks(): Promise<void> {
    try {
      const standings = await this.api.standings();
      this.season.set(standings.season);

      // Weeks that scored, plus every week up to the current one — a week where
      // no owned team won is still a week the league played.
      const upTo = standings.currentWeek ?? 0;
      const played = Array.from({ length: upTo }, (_, index) => index + 1);
      const weeks = [...new Set([...standings.weekly.map((entry) => entry.week), ...played])].sort(
        (a, b) => a - b,
      );
      this.weeks.set(weeks);

      // Respect a manual choice that still exists; otherwise land on the latest
      // week, which is what someone opening this view came to see.
      const current = this.selectedWeek();
      if (current === null || !weeks.includes(current)) {
        this.selectedWeek.set(weeks.at(-1) ?? null);
      }
    } catch {
      // Leave the chips as they are; the next pulse tick retries.
    } finally {
      this.loaded.set(true);
    }
  }

  private async loadScores(week: number): Promise<void> {
    try {
      this.scores.set(await this.api.weekScores(week));
    } catch {
      // Keep the last good table on screen.
    }
  }

  protected readonly rows = computed(() => this.scores()?.rows ?? []);

  /** Bars are relative to the week's best score, so the leader always fills. */
  private readonly maxWeekPoints = computed(() =>
    this.rows().reduce((best, row) => Math.max(best, row.weekPoints), 0),
  );

  /** True when the week is on the board but nobody scored — bars stay at zero. */
  protected readonly weekIsBlank = computed(
    () => this.rows().length > 0 && this.maxWeekPoints() === 0,
  );

  protected barWidth(row: WeekScoresRow): number {
    const max = this.maxWeekPoints();
    return max > 0 ? (row.weekPoints / max) * 100 : 0;
  }

  protected isLeader(row: WeekScoresRow): boolean {
    return row.rank === 1 && row.weekPoints > 0;
  }
}
