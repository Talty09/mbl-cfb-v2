import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { CURRENT_SEASON, avatarColor, initials } from './core/models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private router = inject(Router);
  protected auth = inject(AuthService);

  protected readonly season = CURRENT_SEASON;
  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  protected readonly tabs = [
    { path: '/scoreboard', label: 'Scoreboard' },
    { path: '/standings', label: 'Standings' },
    { path: '/past-scores', label: 'Past Scores' },
    { path: '/locker-room', label: 'Locker Room' },
    { path: '/draft-room', label: 'Draft Room' },
    { path: '/trash-talk', label: 'Trash Talk' },
  ];

  protected async signOut(): Promise<void> {
    // Await the revoke so we don't navigate away while the session is still live
    // on the server.
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
