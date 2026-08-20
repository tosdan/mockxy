import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { ViewRail } from './view-rail';
import { MonitorStreamStore } from './monitor-stream.store';
import { routes } from '../app.routes';
import { translocoTesting } from '../testing/transloco-testing';

/** Doppio dello store della cattura live: il vero apre uno stream SSE nel costruttore. */
const streaming = signal(false);

describe('ViewRail', () => {
  beforeEach(async () => {
    streaming.set(false);
    await TestBed.configureTestingModule({
      imports: [ViewRail, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        provideRouter(routes),
        { provide: MonitorStreamStore, useValue: { streaming } },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(ViewRail);
    fixture.detectChanges();
    return fixture;
  }

  function links(fixture: ReturnType<typeof create>): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('a'));
  }

  it('rende le quattro view come link, nell ordine del rail', () => {
    const fixture = create();
    expect(links(fixture).map((a) => a.textContent?.trim())).toEqual([
      'Catalogo',
      'Monitor',
      'Storico',
      'Dati',
    ]);
  });

  it('punta ogni voce alla rotta della sua view', () => {
    const fixture = create();
    expect(links(fixture).map((a) => a.getAttribute('href'))).toEqual([
      '/mocks',
      '/monitor',
      '/storico',
      '/dati',
    ]);
  });

  it('marca con aria-current soltanto la view corrente', async () => {
    const router = TestBed.inject(Router);
    const fixture = create();
    await router.navigateByUrl('/monitor');
    fixture.detectChanges();

    const current = links(fixture).filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent?.trim())).toEqual(['Monitor']);
  });

  it('mostra il pallino della cattura live solo mentre il monitor sta catturando', () => {
    const fixture = create();
    const monitorLink = () => links(fixture)[1];
    expect(monitorLink().querySelector('.bg-positive')).toBeNull();

    streaming.set(true);
    fixture.detectChanges();
    expect(monitorLink().querySelector('.bg-positive')).not.toBeNull();
  });
});
