import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

/**
 * Login gate. Managers sign in with a username and the passphrase the
 * commissioner issued them — there are no email addresses in this app.
 *
 * Signing in is only required to draft or post in chat; "browse without signing
 * in" is a first-class path, and every read view works as a guest.
 */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected username = '';
  protected password = '';
  protected error = signal<string | null>(null);
  protected busy = signal(false);

  protected async signIn(): Promise<void> {
    if (!this.username.trim() || !this.password) {
      this.error.set('Enter your username and passphrase.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.username, this.password);
      await this.router.navigate(['/scoreboard']);
    } catch {
      // The server returns the same message for an unknown username and a wrong
      // passphrase; don't be more specific here than it is.
      this.error.set('Invalid username or passphrase.');
    } finally {
      this.busy.set(false);
    }
  }

  protected browseAsGuest(): void {
    void this.router.navigate(['/scoreboard']);
  }
}
