import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TrafficDetail } from './traffic-detail';
import type { RequestMonitorEntry } from '../mock-admin-api.types';
import { translocoTesting } from '../testing/transloco-testing';

const ENTRY: RequestMonitorEntry = {
  id: '7',
  timestamp: '2026-10-24T13:05:09.123Z',
  method: 'GET',
  path: '/api/stato-ordine',
  originalUrl: '/api/stato-ordine?x=1',
  status: 202,
  latencyMs: 4,
  source: 'mock',
  requestHeaders: { host: 'localhost', accept: ['a', 'b'] },
  requestBodyBytes: 0,
  requestBodyTruncated: false,
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: '{"stato":"in lavorazione"}',
  responseBodyBytes: 26,
  responseBodyTruncated: true,
};

@Component({
  imports: [TrafficDetail],
  template: `
    <app-traffic-detail [entry]="entry()" [timestampFormat]="format()" [keyTitle]="keyTitle()">
      <button actions type="button">Azione della pagina</button>
    </app-traffic-detail>
  `,
})
class Host {
  readonly entry = signal<RequestMonitorEntry>(ENTRY);
  readonly format = signal('HH:mm:ss.SSS');
  readonly keyTitle = signal<string | null>(null);
}

describe('TrafficDetail', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [Host, translocoTesting()], providers: [provideNoopAnimations()] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const text = () => (host.textContent ?? '').replace(/\s+/g, ' ');
    return { fixture, host, text };
  }

  it('la testata dice metodo, URL, status col suo testo, provenienza, latenza e momento', () => {
    const { text } = create();
    expect(text()).toContain('GET');
    expect(text()).toContain('/api/stato-ordine?x=1');
    expect(text()).toContain('202 Accepted');
    expect(text()).toMatch(/Mock · 4 ms · \d{2}:\d{2}:09\.123/);
  });

  it('il formato del momento e la chiave nel tooltip vengono da chi lo usa (lo Storico)', () => {
    const { fixture, host, text } = create();
    fixture.componentInstance.format.set('dd/MM/yyyy HH:mm:ss.SSS');
    fixture.componentInstance.keyTitle.set('dump-1.ndjson#3');
    fixture.detectChanges();
    expect(text()).toMatch(/24\/10\/2026 \d{2}:\d{2}:09\.123/);
    expect(host.querySelector('[title="dump-1.ndjson#3"]')?.textContent).toContain('Mock');
  });

  it('passo di sequenza ed errore di shared state compaiono solo se ci sono', () => {
    const { fixture, text } = create();
    expect(text()).not.toContain('SEQ');
    fixture.componentInstance.entry.set({
      ...ENTRY,
      sequenceStep: { index: 0, count: 2, responseFile: '001.response.json', responseTitle: 'In lavorazione' },
      sharedStateError: { code: 'SEED_TOO_LARGE', name: 'ordini' },
    });
    fixture.detectChanges();
    expect(text()).toContain('SEQ 1/2');
    expect(text()).toContain('In lavorazione — 001.response.json');
    expect(text()).toContain('SEED_TOO_LARGE · ordini');
  });

  it('le azioni della pagina stanno nella testata', () => {
    const { host } = create();
    const header = host.querySelector('app-traffic-detail > div')!;
    expect(header.querySelector('button')?.textContent).toBe('Azione della pagina');
  });

  it('quattro sezioni con titoli tradotti; headers contati e ordinati, payload assente detto a parole', () => {
    const { fixture, host, text } = create();
    const titles = Array.from(host.querySelectorAll('h2')).map((h) => h.textContent?.trim());
    expect(titles).toEqual(['Request · headers', 'Request · body', 'Response · headers', 'Response · body']);

    // Le sezioni chiuse si aprono dal loro pulsante.
    const triggers = Array.from(host.querySelectorAll<HTMLButtonElement>('ui-collapsible > button'));
    triggers[0].click();
    triggers[1].click();
    fixture.detectChanges();
    const rows = Array.from(host.querySelectorAll('ui-collapsible')[0].querySelectorAll('tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([['accept', 'a, b'], ['host', 'localhost']]);
    expect(text()).toContain('Nessun payload ricevuto.');
    expect(text()).toContain('26 B · troncato');
  });

  it('il body della response è aperto e riempie lo spazio; chiuso, smette di farlo', () => {
    const { fixture, host } = create();
    const section = () => host.querySelectorAll('ui-collapsible')[3].parentElement as HTMLElement;
    expect(section().classList).toContain('flex-1');
    expect(host.querySelector('ui-code')).not.toBeNull();

    host.querySelectorAll<HTMLButtonElement>('ui-collapsible > button')[3].click();
    fixture.detectChanges();
    expect(section().classList).not.toContain('flex-1');
  });
});
