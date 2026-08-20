import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StatusBar } from './status-bar';
import { WorkspaceSummaryStore } from './workspace-summary.store';
import { translocoTesting } from '../testing/transloco-testing';

describe('StatusBar', () => {
  let summary: WorkspaceSummaryStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBar, translocoTesting()],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    summary = TestBed.inject(WorkspaceSummaryStore);
  });

  function create() {
    const fixture = TestBed.createComponent(StatusBar);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ReturnType<typeof create>): string {
    return fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
  }

  it('senza riepilogo non inventa conteggi, ma annuncia comunque la scorciatoia', () => {
    const fixture = create();
    // La palette risponde anche prima che il catalogo sia stato aperto: il suggerimento
    // non dipende dal riepilogo.
    expect(text(fixture)).toContain('Comandi');
    expect(text(fixture)).not.toContain('endpoint');
    expect(fixture.nativeElement.querySelector('div')).not.toBeNull();
  });

  it('mostra i conteggi del workspace appena il riepilogo arriva', () => {
    const fixture = create();
    summary.set({ endpoints: 16, collections: 4, active: 15, loadErrors: [] });
    fixture.detectChanges();

    expect(text(fixture)).toContain('16 endpoint');
    expect(text(fixture)).toContain('4 collection');
    expect(text(fixture)).toContain('15 attivi');
  });

  it('senza definizioni scartate non mostra l avviso', () => {
    const fixture = create();
    summary.set({ endpoints: 3, collections: 0, active: 3, loadErrors: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('apre in un pannello l elenco delle definizioni scartate, con file e motivo', () => {
    const fixture = create();
    summary.set({
      endpoints: 3,
      collections: 0,
      active: 3,
      loadErrors: [{ configFilePath: 'api/rotta/GET.endpoint.json', message: 'status must be a number.' }],
    });
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button')!;
    expect(button.textContent).toContain('1 definizione non caricata');

    button.click();
    fixture.detectChanges();

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('api/rotta/GET.endpoint.json');
    expect(panel.textContent).toContain('status must be a number.');
  });
});
