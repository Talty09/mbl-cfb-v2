import { Component } from '@angular/core';
import { CURRENT_SEASON } from '../../core/models';

/**
 * Draft Room: live 10-round snake draft. Pick board (managers × rounds),
 * on-the-clock card with countdown, available-teams panel with search.
 * Data: GET/POST /api/draft/:year + socket.io 'draft:pick' events +
 * /api/teams/fbs for the pool.
 */
@Component({
  selector: 'app-draft-room-page',
  template: `
    <h1>Draft Room</h1>
    <div class="mbl-card">
      <p class="mbl-label">Live snake draft · {{ season }} · round board coming up</p>
      <p>
        Server-side draft state and realtime events are live (see server/src/routes/draft.ts);
        this view renders the pick board, clock, and team pool next.
        See design_handoff_mbl/screenshots/5-draft-room.png.
      </p>
    </div>
  `,
})
export class DraftRoomPage {
  protected readonly season = CURRENT_SEASON;
}
