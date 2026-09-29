import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeConfigState } from '../mock-admin-api.types';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { runtimeConfigState } from '../testing/runtime-config-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { RuntimeConfigIndicator } from './runtime-config-indicator';

// Configurazione del runtime nella barra di stato (piano agent/API, §13 C8).
describe('RuntimeConfigIndicator', () => {
  let state: RuntimeConfigState;
  const patchRuntimeConfig = vi.fn();

  beforeEach(async () => {
    state = runtimeConfigState();
    patchRuntimeConfig.mockReset();
    await TestBed.configureTestingModule({
      imports: [RuntimeConfigIndicator, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        fakeRuntimeSync().provider,
        { provide: MockAdminApiService, useValue: { getRuntimeConfig: () => of(state), patchRuntimeConfig } },
      ],
    }).compileComponents();
  });

  function open() {
    const fixture = TestBed.createComponent(RuntimeConfigIndicator);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    return { fixture, trigger, panel };
  }

  const row = (panel: HTMLElement, key: string) => panel.querySelector(`[data-key="${key}"]`) as HTMLElement;
  const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('senza override mostra ogni chiave col valore in uso, dichiarando che nulla viene salvato', () => {
    const { trigger, panel } = open();

    expect(text(trigger)).toBe('Configurazione');
    expect(panel.querySelectorAll('[data-key]')).toHaveLength(9);
    expect(text(row(panel, 'backendUrl'))).toContain('http://localhost:8080');
    expect(text(row(panel, 'corsEnabled'))).toContain('disattivo');
    expect(text(row(panel, 'requestTimeoutMs'))).toContain('15000');
    expect(text(panel)).toContain('non vengono salvati e un riavvio del motore li elimina');
    expect(panel.querySelector('[aria-label^="Torna al valore di avvio"]')).toBeNull();
    expect(text(panel)).not.toContain('Torna ai valori di avvio');
  });

  it('con override li conta, mostra il valore di avvio e riporta a quello una chiave o tutte', () => {
    state = runtimeConfigState({ backendUrl: null, globalDelayMs: 1500 });
    patchRuntimeConfig.mockReturnValue(of(runtimeConfigState()));
    const { fixture, trigger, panel } = open();

    expect(text(trigger)).toBe('2 override attivi');
    expect(text(row(panel, 'backendUrl'))).toContain('nessun backend');
    expect(text(row(panel, 'backendUrl'))).toContain("All'avvio: http://localhost:8080");
    expect(text(row(panel, 'globalDelayMs'))).toContain('1500');
    expect(text(row(panel, 'corsEnabled'))).not.toContain('override');

    // Dopo il ripristino la configurazione si rilegge dal server.
    state = runtimeConfigState({ globalDelayMs: 1500 });
    (row(panel, 'backendUrl').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(patchRuntimeConfig).toHaveBeenCalledWith({ unset: ['backendUrl'] });
    expect(text(trigger)).toBe('1 override attivo');

    state = runtimeConfigState();
    const resetAll = Array.from(panel.querySelectorAll('button')).find((button) => text(button) === 'Torna ai valori di avvio') as HTMLButtonElement;
    resetAll.click();
    fixture.detectChanges();
    expect(patchRuntimeConfig).toHaveBeenLastCalledWith({ unset: ['globalDelayMs'] });
    expect(text(trigger)).toBe('Configurazione');
  });

  it('all’apertura il focus entra nel pannello; chiudendo con Escape o con Chiudi torna al pulsante', () => {
    const { fixture, trigger, panel } = open();
    expect(document.activeElement).toBe(panel);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    const reopened = document.querySelector('[role="dialog"]') as HTMLElement;
    (reopened.querySelector('button[aria-label="Chiudi"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
