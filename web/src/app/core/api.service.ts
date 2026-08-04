import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ChatMessageView,
  ChatResponse,
  Manager,
  Meta,
  Pulse,
  RosterCard,
  ScoreboardResponse,
  StandingsResponse,
  TeamOption,
  WeekScoresResponse,
} from 'shared';
import type { DraftState } from 'shared';

/**
 * Typed access to `/api`.
 *
 * Every URL is relative: in development the ng serve proxy forwards `/api` to
 * wrangler on :8787, and in production one Worker serves both the SPA and the
 * API from the same origin. That sameness is also why there is no
 * `withCredentials` and no auth interceptor — the browser attaches the session
 * cookie itself.
 *
 * Response shapes come from the `shared` workspace, so a contract change breaks
 * the build here rather than at runtime.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  private get<T>(url: string, params?: Record<string, string | number>): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(url, params ? { params: new HttpParams({ fromObject: params }) } : {}),
    );
  }

  /** Shell state: season, current week, draft status, ingest freshness. */
  meta(): Promise<Meta> {
    return this.get<Meta>('/api/meta');
  }

  /** Change counters only — see PulseService for how this is used. */
  pulse(): Promise<Pulse> {
    return this.get<Pulse>('/api/pulse');
  }

  managers(): Promise<Manager[]> {
    return this.get<Manager[]>('/api/league/managers');
  }

  draft(): Promise<DraftState> {
    return this.get<DraftState>('/api/draft');
  }

  /** Undrafted teams for the draft pool, or the full league when `available` is false. */
  teams(available = true): Promise<TeamOption[]> {
    return this.get<TeamOption[]>('/api/teams', available ? { available: 1 } : undefined);
  }

  /** Omit `week` to get the current one. */
  scoreboard(week?: number): Promise<ScoreboardResponse> {
    return this.get<ScoreboardResponse>('/api/scoreboard', week ? { week } : undefined);
  }

  standings(): Promise<StandingsResponse> {
    return this.get<StandingsResponse>('/api/standings');
  }

  weekScores(week: number): Promise<WeekScoresResponse> {
    return this.get<WeekScoresResponse>(`/api/weeks/${week}/scores`);
  }

  rosters(): Promise<RosterCard[]> {
    return this.get<RosterCard[]>('/api/rosters');
  }

  /** Pass `since` (the last id seen) to fetch only new messages. */
  chat(since?: number): Promise<ChatResponse> {
    return this.get<ChatResponse>('/api/chat', since === undefined ? undefined : { since });
  }

  postChat(body: string): Promise<ChatMessageView> {
    return firstValueFrom(this.http.post<ChatMessageView>('/api/chat', { body }));
  }

  draftPick(teamId: number): Promise<DraftState> {
    return firstValueFrom(this.http.post<DraftState>('/api/draft/pick', { teamId }));
  }

  /** Commissioner: pick on an unreachable manager's behalf. */
  draftPickFor(userId: string, teamId: number): Promise<DraftState> {
    return firstValueFrom(
      this.http.post<DraftState>('/api/draft/pick-for', { userId, teamId }),
    );
  }

  /** Commissioner: open or close the draft. */
  setDraftStatus(draftStatus: 'pending' | 'active' | 'complete'): Promise<DraftState> {
    return firstValueFrom(this.http.post<DraftState>('/api/draft/status', { draftStatus }));
  }

  /** Commissioner: replace the draft order. Index 0 is slot 1. */
  setDraftOrder(userIds: string[]): Promise<DraftState> {
    return firstValueFrom(this.http.put<DraftState>('/api/draft/order', { userIds }));
  }
}
