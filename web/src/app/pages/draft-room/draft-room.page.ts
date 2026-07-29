import { Component } from '@angular/core';
import { CURRENT_SEASON } from '../../core/models';

/**
 * Draft Room: 10-round snake draft. Pick board (managers × rounds),
 * on-the-clock card, available-teams panel with search.
 *
 * There is no pick clock — the draft runs asynchronously over days and the
 * commissioner nudges managers out of band — so the on-the-clock card shows how
 * long the current manager has been up rather than a countdown.
 *
 * Data: GET /api/draft, POST /api/draft/pick, GET /api/teams?available=1,
 * refreshed by polling /api/pulse.
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
