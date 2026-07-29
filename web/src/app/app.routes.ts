import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'scoreboard' },
  { path: 'login', loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  {
    path: 'scoreboard',
    loadComponent: () => import('./pages/scoreboard/scoreboard.page').then((m) => m.ScoreboardPage),
  },
  {
    path: 'standings',
    loadComponent: () => import('./pages/standings/standings.page').then((m) => m.StandingsPage),
  },
  {
    path: 'past-scores',
    loadComponent: () => import('./pages/past-scores/past-scores.page').then((m) => m.PastScoresPage),
  },
  {
    path: 'locker-room',
    loadComponent: () => import('./pages/locker-room/locker-room.page').then((m) => m.LockerRoomPage),
  },
  {
    path: 'draft-room',
    loadComponent: () => import('./pages/draft-room/draft-room.page').then((m) => m.DraftRoomPage),
  },
  {
    path: 'trash-talk',
    loadComponent: () => import('./pages/trash-talk/trash-talk.page').then((m) => m.TrashTalkPage),
  },
  { path: '**', redirectTo: 'scoreboard' },
];
