import { Component } from '@angular/core';
import { CURRENT_SEASON } from '../../core/models';

/**
 * Scoreboard (default view): this week's games with fantasy point attribution
 * and the "Baller of the Week" banner.
 * Data: /api/scoreboard + /api/games + /api/rankings (CFBD proxy), /api/users.
 */
@Component({
  selector: 'app-scoreboard-page',
  template: `
    <h1>This Week's Games</h1>
    <div class="mbl-card">
      <p class="mbl-label">Scoreboard — coming up</p>
      <p>
        Game cards with live status, AP ranks, owner chips, and point notes land here once the
        {{ season }} season data wiring is in. See design_handoff_mbl/screenshots/1-scoreboard.png.
      </p>
    </div>
  `,
})
export class ScoreboardPage {
  protected readonly season = CURRENT_SEASON;
}
