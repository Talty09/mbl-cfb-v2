import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  GAME_KIND_LABEL,
  type ManagerRef,
  type ScoreboardGame,
  type ScoreboardResponse,
  type ScoreboardTeam,
} from 'shared';
import { ApiService } from '../../core/api.service';
import { PulseService } from '../../core/pulse.service';
import { avatarColor, initials } from '../../core/models';

/** Whether a game has not started, is under way, or is over. */
type GameStatus = 'upcoming' | 'live' | 'final';

/** One team row of a card, fully resolved so the template stays declarative. */
interface TeamRow {
  school: string;
  rank: number | null;
  /** Real-life W-L, or null when we hold no games for this team. */
  record: string | null;
  owner: ManagerRef | null;
  score: string;
  /** The trailing side, drawn muted per the design. */
  dimmed: boolean;
}

interface GameCard {
  id: number;
  status: GameStatus;
  statusLabel: string;
  /** What was earned and why. Null when nobody in the league owned the winner. */
  note: { text: string; highlight: boolean } | null;
  /** Away then home, the order the design lists them in. */
  rows: TeamRow[];
}

/**
 * Scoreboard (default view): one week of games with fantasy point attribution,
 * plus the Baller of the Week banner.
 *
 * Data is `GET /api/scoreboard`, which defaults to the calendar's current week.
 * No point value is computed here — `game.fantasy.points` arrives already scored
 * by the server, which is the only place the rules live.
 */
@Component({
  selector: 'app-scoreboard-page',
  templateUrl: './scoreboard.page.html',
  styleUrl: './scoreboard.page.scss',
})
export class ScoreboardPage {
  private api = inject(ApiService);
  private pulse = inject(PulseService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  /**
   * Last week the stepper will walk to. CFBD's regular-season calendar tops out
   * here; past it are the postseason weeks, which the stepper cannot address
   * (see `canStepWeeks`).
   */
  private static readonly LAST_REGULAR_WEEK = 16;

  private static readonly KICKOFF_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  /** Null means "whatever week the server says is current". */
  private readonly requestedWeek = signal<number | null>(null);
  private readonly data = signal<ScoreboardResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  /** Guards against a slow response for an abandoned week landing last. */
  private latestRequest = 0;

  /**
   * Wall clock as of the last load, used to tell a kickoff that has passed from
   * one that has not. Sampled per load rather than on its own interval: the only
   * thing that can actually change a card is an ingest write, and that already
   * triggers a refetch below.
   */
  private readonly loadedAt = signal(Date.now());

  constructor() {
    // Refetch when the ingest writes anything (scores moved) and when the
    // calendar rolls over to a new week. Both signals are read synchronously so
    // the effect keeps tracking them across the await inside load().
    effect(() => {
      this.pulse.lastSyncAt();
      this.pulse.currentWeek();
      const week = this.requestedWeek();
      void this.load(week);
    });
  }

  private async load(week: number | null): Promise<void> {
    const request = ++this.latestRequest;
    this.loading.set(true);
    try {
      const response = await this.api.scoreboard(week ?? undefined);
      if (request !== this.latestRequest) return;
      this.data.set(response);
      this.loadedAt.set(Date.now());
      this.failed.set(false);
    } catch {
      if (request !== this.latestRequest) return;
      // Keep the last good week on screen; the banner says it may be stale.
      this.failed.set(true);
    } finally {
      if (request === this.latestRequest) this.loading.set(false);
    }
  }

  /** The week actually being shown, which the server picked when we sent none. */
  protected readonly week = computed(() => this.data()?.week ?? null);
  protected readonly season = computed(() => this.data()?.season ?? null);

  protected readonly heading = computed(() => {
    const week = this.week();
    if (week === null) return 'Scoreboard';
    const prefix = this.data()?.seasonType === 'postseason' ? 'Postseason' : 'Week';
    return `${prefix} ${week} Scoreboard`;
  });

  protected readonly cards = computed<GameCard[]>(() =>
    (this.data()?.games ?? []).map((game) => this.toCard(game)),
  );

  /** True once the season is under way — used to word the empty state honestly. */
  private readonly seasonStarted = computed(() => this.pulse.currentWeek() !== null);

  protected readonly emptyMessage = computed(() => {
    if (this.seasonStarted()) return 'No games on the board for this week yet.';
    const season = this.season();
    const subject = season === null ? 'The season' : `The ${season} season`;
    return `${subject} has not kicked off yet. Games appear here as soon as the schedule is ingested.`;
  });

  /** ---- Baller of the Week ---------------------------------------------- */

  protected readonly baller = computed(() => this.data()?.ballerOfTheWeek ?? null);

  /**
   * Stands in for the design's editorial blurb, derived from the week's own
   * cards: every `fantasy` row is a win, so counting them describes the week
   * without inventing a narrative.
   */
  protected readonly ballerBlurb = computed(() => {
    const baller = this.baller();
    const week = this.week();
    if (baller === null) return '';

    const scored = (this.data()?.games ?? []).filter(
      (game) => game.fantasy?.user.id === baller.user.id,
    );
    const ranked = scored.filter((game) => game.fantasy?.beatTop25).length;

    const wins = `${scored.length} ${scored.length === 1 ? 'win' : 'wins'}`;
    const where = week === null ? '' : ` in week ${week}`;
    const rankedNote = ranked === 0 ? '' : ` · ${ranked} over the AP Top 25`;
    return `Led the league with ${wins}${where}${rankedNote}.`;
  });

  /** ---- Week stepping --------------------------------------------------- */

  /**
   * The postseason restarts week numbering, and ApiService.scoreboard() carries
   * no `seasonType`, so a bare `?week=` there would silently resolve to the
   * regular season's week of the same number. Rather than show the wrong games,
   * the postseason gets no stepper — the default (no week param) is still right.
   */
  protected readonly canStepWeeks = computed(() => this.data()?.seasonType === 'regular');

  protected readonly canStepBack = computed(() => this.canStepWeeks() && (this.week() ?? 1) > 1);

  protected readonly canStepForward = computed(
    () => this.canStepWeeks() && (this.week() ?? 0) < ScoreboardPage.LAST_REGULAR_WEEK,
  );

  /** Shown only when the user has stepped off the week the server considers current. */
  protected readonly offCurrentWeek = computed(() => {
    const current = this.pulse.currentWeek();
    return current !== null && this.week() !== null && this.week() !== current;
  });

  protected step(delta: number): void {
    const from = this.week();
    if (from === null) return;
    const next = from + delta;
    if (next < 1 || next > ScoreboardPage.LAST_REGULAR_WEEK) return;
    this.requestedWeek.set(next);
  }

  /** Back to the server-chosen week, rather than pinning a number that will age. */
  protected showCurrentWeek(): void {
    this.requestedWeek.set(null);
  }

  /** ---- Card shaping ---------------------------------------------------- */

  private toCard(game: ScoreboardGame): GameCard {
    const status = this.statusOf(game);
    return {
      id: game.id,
      status,
      statusLabel: this.statusLabel(game, status),
      note: this.noteFor(game),
      rows: [this.toRow(game.away, game.home), this.toRow(game.home, game.away)],
    };
  }

  private statusOf(game: ScoreboardGame): GameStatus {
    if (game.completed) return 'final';
    // A score before the scheduled kickoff, or a game with no start date at all,
    // still means it is under way — CFBD start times move.
    const started =
      game.startDate === null
        ? game.home.points !== null || game.away.points !== null
        : game.startDate <= this.loadedAt();
    return started ? 'live' : 'upcoming';
  }

  private statusLabel(game: ScoreboardGame, status: GameStatus): string {
    if (status === 'final') return 'Final';
    // The design shows a quarter and game clock here, which CFBD's scores feed
    // does not give us; "Live" carries the same meaning honestly.
    if (status === 'live') return 'Live';
    if (game.startDate === null) return 'Time TBD';
    return ScoreboardPage.KICKOFF_FORMAT.format(new Date(game.startDate));
  }

  private noteFor(game: ScoreboardGame): GameCard['note'] {
    const fantasy = game.fantasy;
    if (!fantasy) return null;

    const label = fantasy.beatTop25 ? 'Ranked W' : GAME_KIND_LABEL[fantasy.kind];
    return {
      text: `+${fantasy.points} ${fantasy.user.displayName} · ${label}`,
      // Gold marks a win worth more than a plain one. Tested on the reason, not
      // on a point value, so the pill follows any rule change on the server.
      highlight: fantasy.beatTop25 || fantasy.kind !== 'regular',
    };
  }

  private toRow(team: ScoreboardTeam, opponent: ScoreboardTeam): TeamRow {
    return {
      school: team.school,
      rank: team.rank,
      // Teams we hold no rows for (FCS opponents, an unfilled bowl slot) come
      // back 0-0, which would read as a real record — omit it instead.
      record:
        team.teamId !== null && (team.wins > 0 || team.losses > 0)
          ? `${team.wins}-${team.losses}`
          : null,
      owner: team.owner,
      score: team.points === null ? '—' : String(team.points),
      dimmed: team.points !== null && opponent.points !== null && opponent.points > team.points,
    };
  }
}
