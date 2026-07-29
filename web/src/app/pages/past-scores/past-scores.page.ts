import { Component, signal } from '@angular/core';

/**
 * Past Scores: per-week results with week chips; table re-sorts by the
 * selected week's points.
 * Data: scoring service over /api/games + /api/rankings + /api/users rosters.
 */
@Component({
  selector: 'app-past-scores-page',
  template: `
    <h1>Past Scores</h1>
    <div class="week-chips">
      @for (week of weeks; track week) {
        <button
          class="chip"
          type="button"
          [class.selected]="week === selectedWeek()"
          (click)="selectedWeek.set(week)"
        >
          WK {{ week }}
        </button>
      }
    </div>
    <div class="mbl-card">
      <p class="mbl-label">Week {{ selectedWeek() }} results — coming up</p>
      <p>Weekly point table with score bars. See design_handoff_mbl/screenshots/3-past-scores.png.</p>
    </div>
  `,
  styles: `
    .week-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .chip {
      background: var(--mbl-surface);
      border: 1px solid var(--mbl-border);
      border-radius: 6px;
      color: var(--mbl-text-2);
      font-family: var(--mbl-font-display);
      font-weight: 700;
      letter-spacing: 1px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .chip.selected {
      background: var(--mbl-gold);
      border-color: var(--mbl-gold);
      color: var(--mbl-bg-deep);
    }
  `,
})
export class PastScoresPage {
  // TODO: derive from the season calendar instead of hardcoding
  protected readonly weeks = Array.from({ length: 8 }, (_, i) => i + 1);
  protected readonly selectedWeek = signal(1);
}
