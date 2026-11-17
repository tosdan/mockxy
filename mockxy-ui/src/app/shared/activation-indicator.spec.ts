import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { vi } from 'vitest';
import type { ActivationItem } from '../mock-admin-api.types';
import { fakeActivation } from '../testing/activation-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { ActivationIndicator } from './activation-indicator';

// Il pannello della barra di stato: il solo punto in cui lo stato temporaneo si vede tutto
// insieme, con ciò che dice il file accanto a ciò che risponde ora.
describe('ActivationIndicator', () => {
  const legacy: ActivationItem = {
    id: 'legacy',
    method: 'GET',
    path: '/api/legacy',
    enabled: true,
    saved: { enabled: false, responseFile: '001.response.json', responseTitle: 'Gone', responseStatus: 410 },
  };
  const status: ActivationItem = {
    id: 'status',
    method: 'GET',
    path: '/api/status',
    responseFile: '002.response.json',
    responseTitle: 'Non trovato',
    responseStatus: 404,
    saved: { enabled: true, responseFile: '001.response.json', responseTitle: 'OK', responseStatus: 200 },
  };
  // Il file dell'endpoint è momentaneamente illeggibile: l'attivazione resta, senza id né `saved`.
  const rotto: ActivationItem = { id: null, method: 'GET', path: '/api/rotto', enabled: true };

  let activation: ReturnType<typeof fakeActivation>;
  const navigate = vi.fn();

  function create(items: ActivationItem[]) {
    activation = fakeActivation(items);
    navigate.mockReset();
    TestBed.configureTestingModule({
      imports: [ActivationIndicator, translocoTesting()],
      providers: [provideNoopAnimations(), activation.provider, { provide: Router, useValue: { navigate } }],
    });
    const fixture = TestBed.createComponent(ActivationIndicator);
    fixture.detectChanges();
    return fixture;
  }

  function open(fixture: ReturnType<typeof create>): HTMLElement {
    (fixture.nativeElement.querySelector('[data-activation-open]') as HTMLElement).click();
    fixture.detectChanges();
    return document.querySelector('[role="dialog"]') as HTMLElement;
  }

  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const row = (panel: HTMLElement, key: string) => panel.querySelector(`[data-activation-item="${key}"]`) as HTMLElement;
  const button = (scope: HTMLElement, label: string) => Array.from(scope.querySelectorAll('button')).find((element) => text(element) === label) as HTMLButtonElement;

  afterEach(() => document.querySelector('.cdk-overlay-container')?.replaceChildren());

  it('elenca per ogni endpoint cosa risponde ora e cosa dice il file, per i soli campi temporanei', () => {
    const panel = open(create([legacy, status]));

    expect(panel.getAttribute('aria-label')).toBe('Stato temporaneo');
    expect(text(row(panel, 'GET /api/legacy').querySelector('[data-activation-now]'))).toBe('ora acceso');
    expect(text(row(panel, 'GET /api/legacy').querySelector('[data-activation-saved]'))).toBe('Nel file: spento');
    expect(text(row(panel, 'GET /api/status').querySelector('[data-activation-now]'))).toBe('ora Non trovato 404');
    expect(text(row(panel, 'GET /api/status').querySelector('[data-activation-saved]'))).toBe('Nel file: OK 200');
  });

  it('«Salva così» scrive nel file lo stato di quell\'endpoint, la X lo riporta a come è salvato', () => {
    const panel = open(create([legacy, status]));

    button(row(panel, 'GET /api/status'), 'Salva così').click();
    expect(activation.calls.save).toEqual([[status]]);

    (row(panel, 'GET /api/legacy').querySelector('[aria-label="Torna a come è salvato: GET /api/legacy"]') as HTMLElement).click();
    expect(activation.calls.remove).toEqual(['legacy']);
  });

  it('«Salva tutto nei file» e «Azzera» agiscono su tutto lo scenario', () => {
    const panel = open(create([legacy, status]));

    button(panel, 'Salva tutto nei file').click();
    expect(activation.calls.save).toEqual([[legacy, status]]);

    button(panel, 'Azzera').click();
    expect(activation.calls.clear).toBe(1);
  });

  it("un endpoint il cui file non si legge resta in elenco, ma non si salva e non si toglie da qui", () => {
    const panel = open(create([rotto]));
    const item = row(panel, 'GET /api/rotto');

    expect(text(item.querySelector('[data-activation-saved]'))).toBe("Il file dell'endpoint non si legge");
    expect(button(item, 'Salva così').disabled).toBe(true);
    expect(button(panel, 'Salva tutto nei file').disabled).toBe(true);
    // «Azzera» resta: toglie lo scenario intero, senza bisogno dell'id.
    expect(button(panel, 'Azzera').disabled).toBe(false);
  });

  it("il percorso apre l'endpoint nel catalogo e chiude il pannello", () => {
    const fixture = create([status]);
    const panel = open(fixture);

    (panel.querySelector('[aria-label="Apri GET /api/status nel catalogo"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/status' } });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("quando l'ultimo stato temporaneo se ne va, il pannello si chiude con lui", () => {
    const fixture = create([status]);
    open(fixture);

    activation.items.set([]);
    fixture.detectChanges();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-activation-indicator]')).toBeNull();
  });
});
