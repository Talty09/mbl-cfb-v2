import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ApiError, DraftPickView, DraftState, TeamOption } from 'shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PulseService } from '../../core/pulse.service';
import { avatarColor, initials } from '../../core/models';

/** One square of the pick board: a made pick, the live pick, or a future one. */
interface BoardCell {
  round: number;
  /** 1-based column, i.e. the manager's slot in the draft order. */
  slot: number;
  pick: DraftPickView | null;
  onClock: boolean;
}

interface BoardRow {
  round: number;
  cells: BoardCell[];
}

/**
 * How long the current manager has been up. Minute granularity is as precise as
 * a multi-day draft warrants, and it is what lets the label be recomputed on a
 * slow local timer instead of by refetching.
 */
function elapsedLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'for less than a minute';
  if (minutes < 60) return `for ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `for ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'for 1 day' : `for ${days} days`;
}

/**
 * Prefer the server's own wording for a refused pick: it knows whether the team
 * was taken, whose turn it actually is, or that the draft closed, and any of
 * those is more useful than a generic failure.
 */
function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as ApiError | null;
    if (body && typeof body.error === 'string') return body.error;
  }
  return fallback;
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Draft Room: 10-round snake draft — pick board, who is up, and the pool of
 * undrafted teams.
 *
 * There is no pick clock. The design handoff specifies a 90-second countdown,
 * but the league runs the draft asynchronously over days with the commissioner
 * nudging people out of band, so a countdown would only ever be expired. The
 * card keeps its prominence and reports elapsed time instead.
 *
 * The draft is server-authoritative: this view never derives whose turn it is or
 * whether a team is available, and every write answers with the new `DraftState`
 * so the board is redrawn from the server's own account of the draft.
 */
@Component({
  selector: 'app-draft-room-page',
  imports: [RouterLink],
  templateUrl: './draft-room.page.html',
  styleUrl: './draft-room.page.scss',
})
export class DraftRoomPage implements OnDestroy {
  private api = inject(ApiService);
  private pulse = inject(PulseService);
  protected auth = inject(AuthService);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  protected readonly state = signal<DraftState | null>(null);
  protected readonly pool = signal<TeamOption[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Team id of a pick in flight, so the list can't be double-submitted. */
  protected readonly busyTeamId = signal<number | null>(null);
  /** Commissioner armed the proxy toggle, so DRAFT acts for the manager on the clock. */
  protected readonly proxying = signal(false);
  protected readonly confirmRandomize = signal(false);
  protected readonly search = signal('');

  /** Reference point for the elapsed label; only this signal ticks. */
  private readonly now = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | undefined;
  private seenPulse: string | null = null;

  /** The label is minute-granular, so a half-minute tick keeps it honest. */
  private static readonly TICK_MS = 30_000;

  constructor() {
    void this.load();

    this.timer = setInterval(() => this.now.set(Date.now()), DraftRoomPage.TICK_MS);

    // Somebody else's pick — or the commissioner opening the draft — reaches this
    // tab only through the pulse counters. Watch both, and skip the first run so
    // the poller's initial value doesn't duplicate the load above.
    effect(() => {
      const key = `${this.pulse.pickCount()}:${this.pulse.draftStatus()}`;
      const seen = this.seenPulse;
      this.seenPulse = key;
      if (seen !== null && seen !== key) void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      const [state, pool] = await Promise.all([this.api.draft(), this.api.teams()]);
      this.applyState(state);
      this.pool.set(pool);
    } catch {
      // Leave the last good board up; the pulse poller will try again.
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Adopt new draft state, disarming the proxy toggle when the clock has moved
   * on — an armed toggle left over from the previous manager would otherwise
   * pick for whoever came up next.
   */
  private applyState(next: DraftState): void {
    if (next.onClockUser?.id !== this.state()?.onClockUser?.id) this.proxying.set(false);
    this.state.set(next);
  }

  protected readonly headline = computed(() => {
    const state = this.state();
    if (!state) return 'Draft Room';
    if (state.draftStatus === 'pending') return 'Draft not open';
    if (state.draftStatus === 'complete' || state.currentRound === null) return 'Draft complete';
    return `Round ${state.currentRound} of ${state.rounds} · Pick ${state.nextPickNumber}`;
  });

  /** Explains the two states where the board is not the point of the page. */
  protected readonly statusNote = computed(() => {
    const state = this.state();
    if (!state) return null;
    if (state.draftStatus === 'pending') {
      return state.order.length === 0
        ? 'The draft order has not been set yet. Nothing is on the clock.'
        : 'The commissioner has not opened the draft yet. The board fills in once picks start.';
    }
    if (state.draftStatus === 'complete') {
      return `All ${state.picks.length} picks are in — rosters are final. See the Locker Room.`;
    }
    return null;
  });

  protected readonly onClockFor = computed(() => {
    const since = this.state()?.onClockSince;
    if (since == null) return null;
    return elapsedLabel(this.now() - since);
  });

  protected readonly gridColumns = computed(
    () => `40px repeat(${this.state()?.order.length ?? 0}, minmax(70px, 1fr))`,
  );

  /**
   * Cell placement is read back from the pick records — a pick's own `round` plus
   * its manager's slot — rather than recomputed from a local snake formula, so
   * the board cannot disagree with the draft the server is running.
   */
  protected readonly board = computed<BoardRow[]>(() => {
    const state = this.state();
    if (!state || state.order.length === 0) return [];

    const slotOf = new Map(state.order.map((manager, index) => [manager.id, index + 1]));
    const byCell = new Map<string, DraftPickView>();
    for (const pick of state.picks) {
      const slot = slotOf.get(pick.user.id);
      if (slot !== undefined) byCell.set(`${pick.round}:${slot}`, pick);
    }

    const clockSlot =
      state.onClockUser === null ? undefined : slotOf.get(state.onClockUser.id);

    return Array.from({ length: state.rounds }, (_unused, index) => {
      const round = index + 1;
      return {
        round,
        cells: state.order.map((_manager, column) => {
          const slot = column + 1;
          return {
            round,
            slot,
            pick: byCell.get(`${round}:${slot}`) ?? null,
            onClock:
              state.draftStatus === 'active' && round === state.currentRound && slot === clockSlot,
          };
        }),
      };
    });
  });

  protected readonly filteredPool = computed(() => {
    const query = this.search().trim().toLowerCase();
    const pool = this.pool();
    // The API already returns the pool sorted by AP rank then school; filtering
    // preserves that, so there is nothing to sort here.
    return query === '' ? pool : pool.filter((team) => team.school.toLowerCase().includes(query));
  });

  protected readonly isCommissioner = computed(() => this.auth.user()?.isCommissioner === true);

  protected readonly myTurn = computed(() => {
    const me = this.auth.user();
    const onClock = this.state()?.onClockUser;
    return me !== null && onClock != null && me.id === onClock.id;
  });

  /** The manager the commissioner can pick for: on the clock, and not themselves. */
  protected readonly proxyTarget = computed(() => {
    const state = this.state();
    if (!this.isCommissioner() || state?.draftStatus !== 'active') return null;
    const onClock = state.onClockUser;
    if (onClock === null || onClock.id === this.auth.user()?.id) return null;
    return onClock;
  });

  /** Non-null only while the proxy toggle is armed, for the banner that says so. */
  protected readonly proxyBanner = computed(() => (this.proxying() ? this.proxyTarget() : null));

  /** DRAFT buttons only exist while the draft is live — never on a closed board. */
  protected readonly draftable = computed(() => this.state()?.draftStatus === 'active');

  protected readonly canPick = computed(
    () => this.draftable() && (this.myTurn() || (this.proxying() && this.proxyTarget() !== null)),
  );

  /** Reordering rewrites who owned which slot, so the API rejects it once picks exist. */
  protected readonly orderLocked = computed(() => (this.state()?.picks.length ?? 0) > 0);

  protected cellTitle(pick: DraftPickView): string {
    const suffix = pick.madeByCommissioner ? ' (made by the commissioner)' : '';
    return `Pick ${pick.pickNumber} · ${pick.user.displayName} · ${pick.team.school}${suffix}`;
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected async pick(team: TeamOption): Promise<void> {
    if (!this.canPick() || this.busyTeamId() !== null) return;
    const target = this.proxying() ? this.proxyTarget() : null;

    this.busyTeamId.set(team.id);
    this.error.set(null);
    try {
      const next = target
        ? await this.api.draftPickFor(target.id, team.id)
        : await this.api.draftPick(team.id);
      this.applyState(next);
      this.pool.set(await this.api.teams());
      // Keep the shared counter in step so this tab doesn't refetch again on the
      // next tick just because it moved ahead of the poller.
      await this.pulse.refresh();
    } catch (error) {
      this.error.set(serverMessage(error, 'That pick did not go through.'));
      // A 403 or 409 means the draft moved without us — resync rather than leave
      // a board that argues with the server.
      await this.load();
    } finally {
      this.busyTeamId.set(null);
    }
  }

  protected async setStatus(draftStatus: 'pending' | 'active' | 'complete'): Promise<void> {
    this.error.set(null);
    try {
      this.applyState(await this.api.setDraftStatus(draftStatus));
    } catch (error) {
      this.error.set(serverMessage(error, 'Could not change the draft status.'));
      await this.load();
    }
  }

  /**
   * Two clicks: throwing away an order the league has already seen is worth a
   * confirmation, and a second press is cheaper than a dialog.
   */
  protected async randomizeOrder(): Promise<void> {
    if (!this.confirmRandomize()) {
      this.confirmRandomize.set(true);
      return;
    }
    this.confirmRandomize.set(false);
    this.error.set(null);
    try {
      // The API wants every manager exactly once, so the roster of managers — not
      // the current order — is the source: it is right even before an order exists.
      const managers = await this.api.managers();
      this.applyState(await this.api.setDraftOrder(shuffled(managers.map((m) => m.id))));
    } catch (error) {
      this.error.set(serverMessage(error, 'Could not set the draft order.'));
      await this.load();
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
