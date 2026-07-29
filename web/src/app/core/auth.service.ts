import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SessionResponse, SessionUser } from './models';

/**
 * Session state.
 *
 * The session token lives in an httpOnly cookie the browser attaches
 * automatically, so there is nothing to store here and no Authorization header
 * to set — hence no interceptor. It also means script cannot read the token, so
 * an XSS bug can't exfiltrate it, which localStorage could never promise.
 *
 * The trade-off is that the client cannot know whether it is signed in without
 * asking, so `restore()` runs once at startup to resolve it.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  private readonly userSignal = signal<SessionUser | null>(null);
  readonly user = this.userSignal.asReadonly();
  readonly isSignedIn = computed(() => this.userSignal() !== null);

  /** False until the initial `/auth/me` settles, so the UI can avoid flicker. */
  private readonly readySignal = signal(false);
  readonly ready = this.readySignal.asReadonly();

  /**
   * Resolve the cookie into a user on startup. Guests get `{ user: null }` with a
   * 200, so this is not an error path.
   */
  async restore(): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.get<SessionResponse>('/api/auth/me'));
      this.userSignal.set(response.user);
    } catch {
      // Offline, or the API is down. Fall back to guest rather than blocking the
      // app — every read view works without a session.
      this.userSignal.set(null);
    } finally {
      this.readySignal.set(true);
    }
  }

  async login(username: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/login', { username, password }),
    );
    this.userSignal.set(response.user);
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<SessionResponse>('/api/auth/logout', {}));
    } finally {
      // Clear locally even if the request failed: the cookie is either already
      // gone or will be rejected on next use.
      this.userSignal.set(null);
    }
  }
}
