import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { translocoTesting } from './testing/transloco-testing';
import { ToastService } from './ui/ui-toast/ui-toast';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        provideRouter(routes),
        // Stub del ToastService: gli store globali (runtime-bar) falliscono le chiamate HTTP nel
        // test e l'errore passa per LiveAnnouncer della CDK, che crasha in jsdom. Lo neutralizziamo.
        { provide: ToastService, useValue: { toasts: signal([]), show: () => {}, dismiss: () => {} } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
