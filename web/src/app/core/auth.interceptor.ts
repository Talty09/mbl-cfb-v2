import { HttpInterceptorFn } from '@angular/common/http';

/** Attach the session JWT to API requests when signed in. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('mbl_token');
  if (token && req.url.startsWith('/api')) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};
