import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'mocks',
  },
  {
    // Schermata Mocks: primitivi del design system cablati ai dati reali.
    path: 'mocks',
    loadComponent: () => import('./pages/mocks-next/mocks-next.page').then((module) => module.MocksNextPage),
  },
  {
    path: 'mocks-next',
    redirectTo: 'mocks',
  },
  {
    path: 'definitions',
    redirectTo: 'mocks',
  },
  {
    // Monitor live delle request intercettate.
    path: 'monitor',
    loadComponent: () => import('./pages/monitor-next/monitor-next.page').then((module) => module.MonitorNextPage),
  },
  {
    path: 'monitor-next',
    redirectTo: 'monitor',
  },
  {
    // Storico dei dump su disco (browse read-only, non live) → creazione massiva di mock.
    path: 'storico',
    loadComponent: () => import('./pages/storico-dump/storico-dump.page').then((module) => module.StoricoDumpPage),
  },
  {
    // File dati JSON riusabili dagli handler via data('nome').
    path: 'dati',
    loadComponent: () => import('./pages/dati/dati.page').then((module) => module.DatiPage),
  },
  {
    // Design System — riferimento navigabile di token e componenti.
    path: 'design-system',
    loadComponent: () => import('./pages/design-system/design-system.page').then((module) => module.DesignSystemPage),
  },
  {
    path: '**',
    redirectTo: 'mocks',
  },
];
