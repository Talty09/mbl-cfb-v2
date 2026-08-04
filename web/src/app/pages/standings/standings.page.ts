import { Component, computed, effect, inject, signal } from '@angular/core';
import type { StandingsResponse, StandingsRow } from 'shared';
import { ApiService } from '../../core/api.service';
import { avatarColor, initials } from '../../core/models';
import { PulseService } from '../../core/pulse.service';

/** One mirrored row of the Rivalry Watch chart. */
interface RivalryWeek {
  label: string;
  aWidth: number;
  bWidth: number;
  /** Bars carry no numbers, so the figures live in a tooltip. */
  title: string;
}

/**
 * Standings: the season leaderboard plus the Rivalry Watch panel.
 *
 * `rank` is rendered exactly as `/api/standings` sends it. The league has no
 * tiebreaker, so the server hands tied managers the same rank; re-ranking here
 * would assert an order nobody has agreed to.
 */
@Component({
  selector: 'app-standings-page',
  templateUrl: './standings.page.html',
  styleUrl: './standings.page.scss',
})
export class StandingsPage {
  private api = inject(ApiService);
  private pulse = inject(PulseService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  private readonly data = signal<StandingsResponse | null>(null);
  /** False until the first request settles, to tell "empty" from "not yet". */
  protected readonly loaded = signal(false);

  /** Rivalry Watch selections; null means "use the top two on the table". */
  private readonly pickedA = signal<string | null>(null);
  private readonly pickedB = signal<string | null>(null);

  constructor() {
    // The ingest is the only thing that moves standings, so its timestamp is the
    // entire refetch trigger — and this runs once on init for the first load.
    effect(() => {
      this.pulse.lastSyncAt();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await this.api.standings());
    } catch {
      // Keep the last good table on screen; the next pulse tick retries.
    } finally {
      this.loaded.set(true);
    }
  }

  protected readonly rows = computed(() => this.data()?.rows ?? []);

  /** Header column label, since the week the "WK" column covers is the live one. */
  protected readonly weekColumn = computed(() => {
    const week = this.data()?.currentWeek;
    return week === null || week === undefined ? 'WK' : `WK ${week}`;
  });

  protected readonly throughLabel = computed(() => {
    const data = this.data();
    if (!data) return '';
    return data.currentWeek === null
      ? 'Preseason · no games scored'
      : `Through week ${data.currentWeek}`;
  });

  /** Nobody leads a scoreless season — don't gild an eleven-way tie at zero. */
  protected isLeader(row: StandingsRow): boolean {
    return row.rank === 1 && row.total > 0;
  }

  protected readonly rivalry = computed(() => {
    const a = this.resolve(this.pickedA(), 0);
    const b = this.resolve(this.pickedB(), 1);
    return a && b ? { a, b } : null;
  });

  private resolve(id: string | null, fallbackIndex: number): StandingsRow | null {
    const rows = this.rows();
    return (id ? rows.find((row) => row.user.id === id) : undefined) ?? rows[fallbackIndex] ?? null;
  }

  protected readonly rivalryWeeks = computed<RivalryWeek[]>(() => {
    const pair = this.rivalry();
    const weekly = this.data()?.weekly ?? [];
    if (!pair) return [];

    const points = (week: (typeof weekly)[number], id: string) => week.points[id] ?? 0;

    // Scale to the best single week either manager has had rather than a fixed
    // ceiling, and never divide by zero when neither has scored.
    const max = weekly.reduce(
      (best, week) =>
        Math.max(best, points(week, pair.a.user.id), points(week, pair.b.user.id)),
      0,
    );

    return weekly.map((week) => {
      const a = points(week, pair.a.user.id);
      const b = points(week, pair.b.user.id);
      return {
        label: `W${week.week}`,
        aWidth: max > 0 ? (a / max) * 100 : 0,
        bWidth: max > 0 ? (b / max) * 100 : 0,
        title: `Week ${week.week} — ${pair.a.user.displayName} ${a} · ${pair.b.user.displayName} ${b}`,
      };
    });
  });

  protected readonly rivalrySub = computed(() => {
    const pair = this.rivalry();
    if (!pair) return '';

    const weeks = this.rivalryWeeks().length;
    const scope =
      weeks === 0 ? 'no weeks scored yet' : weeks === 1 ? 'through one week' : `through ${weeks} weeks`;
    const gap = Math.abs(pair.a.total - pair.b.total);
    return gap === 0
      ? `Level on ${pair.a.total} — ${scope}`
      : `${gap} point${gap === 1 ? '' : 's'} apart — ${scope}`;
  });

  protected chooseA(event: Event): void {
    this.pickedA.set((event.target as HTMLSelectElement).value);
  }

  protected chooseB(event: Event): void {
    this.pickedB.set((event.target as HTMLSelectElement).value);
  }
}
