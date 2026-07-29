import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CURRENT_SEASON, Manager, avatarColor, initials } from '../../core/models';

/**
 * Locker Room: each manager's 10 drafted teams as chips.
 * Data: /api/users?season=YYYY (rosters) + /api/teams/fbs for names/ranks.
 */
@Component({
  selector: 'app-locker-room-page',
  template: `
    <h1>Locker Room</h1>
    <div class="roster-grid">
      @for (manager of managers(); track manager.id) {
        <div class="mbl-card">
          <div class="card-head">
            <span class="avatar" [style.background]="avatarColor(manager.avatarHue)">
              {{ initials(manager.displayName) }}
            </span>
            <span class="name">{{ manager.displayName }}</span>
          </div>
          @if (manager.rosterSpots.length > 0) {
            <div class="chips">
              @for (spot of manager.rosterSpots; track spot.teamId) {
                <!-- TODO: resolve teamId to name/rank via /api/teams/fbs -->
                <span class="team-chip">Team #{{ spot.teamId }}</span>
              }
            </div>
          } @else {
            <p class="mbl-label">No roster yet — see you in the draft room</p>
          }
        </div>
      } @empty {
        <div class="mbl-card">
          <p class="mbl-label">No managers loaded</p>
          <p>Start the server and seed the database (see server/README notes in CLAUDE.md).</p>
        </div>
      }
    </div>
  `,
  styles: `
    .roster-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 14px;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: var(--mbl-bg-deep);
      font-weight: 700;
      font-size: 12px;
    }
    .name {
      font-family: var(--mbl-font-display);
      font-weight: 800;
      font-size: 20px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .team-chip {
      background: var(--mbl-chip);
      border: 1px solid var(--mbl-border);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 13px;
    }
  `,
})
export class LockerRoomPage {
  private http = inject(HttpClient);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  protected readonly managers = toSignal(
    this.http.get<Manager[]>(`/api/users?season=${CURRENT_SEASON}`),
    { initialValue: [] as Manager[] },
  );
}
