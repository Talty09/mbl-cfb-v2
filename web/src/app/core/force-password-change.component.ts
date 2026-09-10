import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

/**
 * Blocking overlay shown whenever the signed-in manager is still on the
 * commissioner-issued one-time passphrase. Mounted globally in the app shell
 * (see app.html) so it appears regardless of the current route.
 *
 * The field is plain text rather than masked: there's no complexity rule to
 * enforce here, and the only recovery if someone mistypes a hidden password is
 * asking the commissioner to reissue one — showing it removes that risk for
 * free instead of adding a second "confirm" field.
 */
@Component({
  selector: 'app-force-password-change',
  imports: [FormsModule],
  templateUrl: './force-password-change.component.html',
  styleUrl: './force-password-change.component.scss',
})
export class ForcePasswordChangeComponent {
  private auth = inject(AuthService);

  protected newPassword = '';
  protected error = signal<string | null>(null);
  protected busy = signal(false);

  protected async submit(): Promise<void> {
    if (this.newPassword.length < 4) {
      this.error.set('Choose a password at least 4 characters long.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.changePassword(this.newPassword);
    } catch {
      this.error.set('Could not set your password — try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
