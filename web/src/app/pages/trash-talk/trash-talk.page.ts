import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Socket, io } from 'socket.io-client';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { CURRENT_SEASON, ChatMessage, avatarColor, initials } from '../../core/models';

/**
 * Trash Talk: league group chat. History via GET /api/chat/:year, posts via
 * POST /api/chat/:year (auth required), live updates via socket.io.
 */
@Component({
  selector: 'app-trash-talk-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './trash-talk.page.html',
  styleUrl: './trash-talk.page.scss',
})
export class TrashTalkPage implements OnDestroy {
  private http = inject(HttpClient);
  protected auth = inject(AuthService);

  protected readonly messages = signal<ChatMessage[]>([]);
  protected draft = '';
  protected readonly sending = signal(false);

  protected readonly avatarColor = avatarColor;
  protected readonly initials = initials;

  private socket: Socket = io();

  constructor() {
    this.http
      .get<ChatMessage[]>(`/api/chat/${CURRENT_SEASON}`)
      .subscribe((history) => this.messages.set(history));

    this.socket.on('chat:message', (message: ChatMessage) => {
      this.messages.update((current) => [...current, message]);
    });
  }

  protected async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body || this.sending()) return;
    this.sending.set(true);
    try {
      // The socket broadcast delivers the message back to us; no local append.
      await firstValueFrom(this.http.post(`/api/chat/${CURRENT_SEASON}`, { body }));
      this.draft = '';
    } finally {
      this.sending.set(false);
    }
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }
}
