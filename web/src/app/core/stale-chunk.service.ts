import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Recovers from a stale tab after a deploy.
 *
 * Views are lazy-loaded and their filenames are content-hashed, so a deploy
 * replaces every chunk name. A tab that was open beforehand still holds the old
 * index, and the moment someone clicks a nav item the browser asks for a chunk
 * that no longer exists. Angular reports a NavigationError and the click appears
 * to do nothing at all — no error, no navigation, just a dead menu.
 *
 * That is exactly what happens to eleven managers sitting on the draft page when
 * a new version ships, so the app reloads itself instead of looking broken.
 */
@Injectable({ providedIn: 'root' })
export class StaleChunkService {
  private router = inject(Router);
  private document = inject(DOCUMENT);
  private destroyRef = inject(DestroyRef);

  /**
   * Guards against a reload loop. If the fetch failed because the server is
   * genuinely down rather than because the chunk moved, reloading will not help
   * and must not be retried forever. sessionStorage rather than a field: the
   * reload wipes any in-memory state.
   */
  private static readonly ATTEMPTED_KEY = 'mbl_stale_chunk_reload';

  start(): void {
    const view = this.document.defaultView;
    if (!view) return;

    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        // A navigation worked, so whatever went wrong is behind us — re-arm for
        // the next deploy.
        this.clearAttempt(view);
        return;
      }

      if (event instanceof NavigationError && isChunkLoadFailure(event.error)) {
        if (view.sessionStorage?.getItem(StaleChunkService.ATTEMPTED_KEY)) return;
        view.sessionStorage?.setItem(StaleChunkService.ATTEMPTED_KEY, '1');
        view.location.reload();
      }
    });

    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  private clearAttempt(view: Window): void {
    try {
      view.sessionStorage?.removeItem(StaleChunkService.ATTEMPTED_KEY);
    } catch {
      // Private browsing can refuse sessionStorage; losing the guard is better
      // than breaking navigation over it.
    }
  }
}

/**
 * Browsers disagree on how a failed dynamic import surfaces: Chrome throws a
 * TypeError mentioning the module, Firefox and Safari word it differently, and
 * some bundlers raise a named ChunkLoadError. Match on all of them rather than
 * on one engine's phrasing.
 */
function isChunkLoadFailure(error: unknown): boolean {
  if (!error) return false;

  const name = (error as { name?: unknown }).name;
  if (name === 'ChunkLoadError') return true;

  const message = String((error as { message?: unknown }).message ?? error).toLowerCase();
  return (
    message.includes('dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('chunkloaderror')
  );
}
