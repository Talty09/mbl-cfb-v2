import { Component } from '@angular/core';

/**
 * Standings: season leaderboard (rank / manager / week points / ranked wins /
 * total) plus the Rivalry Watch panel.
 * Data: scoring service over /api/games + /api/rankings + /api/users rosters.
 */
@Component({
  selector: 'app-standings-page',
  template: `
    <h1>Standings</h1>
    <div class="mbl-card">
      <p class="mbl-label">Leaderboard — coming up</p>
      <p>
        Season totals per manager with the leader row in gold, plus Rivalry Watch.
        See design_handoff_mbl/screenshots/2-standings.png.
      </p>
    </div>
  `,
})
export class StandingsPage {}
