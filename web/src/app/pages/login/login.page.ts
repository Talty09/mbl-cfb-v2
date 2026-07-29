import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  protected email = '';
  protected password = '';
  protected error = signal<string | null>(null);
  protected busy = signal(false);

  protected async signIn(): Promise<void> {
    if (!this.email.includes('@') || !this.password) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email, this.password);
      this.router.navigate(['/scoreboard']);
    } catch {
      this.error.set('Invalid email or password.');
    } finally {
      this.busy.set(false);
    }
  }

  protected browseAsGuest(): void {
    this.router.navigate(['/scoreboard']);
  }
}
