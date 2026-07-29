import { provideHttpClient } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { AuthService } from './core/auth.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    /**
     * No interceptor. The session is an httpOnly cookie, and browsers attach
     * cookies to same-origin requests on their own — which every `/api/...` call
     * is, in dev through the ng serve proxy and in production because one Worker
     * serves both the SPA and the API. `withCredentials` would only matter
     * cross-origin.
     */
    provideHttpClient(),
    // Resolve the cookie into a user before the first view renders, so the shell
    // doesn't flash a signed-out state for a manager who is already signed in.
    provideAppInitializer(() => inject(AuthService).restore()),
  ],
};
