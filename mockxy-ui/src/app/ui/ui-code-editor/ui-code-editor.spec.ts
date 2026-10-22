import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { UiCodeEditor } from './ui-code-editor';
import { translocoTesting } from '../../testing/transloco-testing';

@Component({
  imports: [UiCodeEditor],
  template: `<ui-code-editor [ariaLabel]="label()" value="{}" />`,
})
class Host {
  readonly label = signal<string | null>('Prima etichetta');
}

describe('UiCodeEditor', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host, translocoTesting()] }).compileComponents();
  });

  async function mount() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable(); // l'editor nasce dopo il primo render
    const content = () => (fixture.nativeElement as HTMLElement).querySelector('.cm-content') as HTMLElement;
    return { fixture, content };
  }

  // Coi dizionari gia' pronti il primo giro dell'effetto avviene prima che l'editor esista: l'etichetta
  // deve diventarne comunque una dipendenza, o il cambio del solo input andrebbe perso.
  it('il nome accessibile segue l\'input ariaLabel, e senza ricade su quello tradotto', async () => {
    const { fixture, content } = await mount();
    expect(content().getAttribute('aria-label')).toBe('Prima etichetta');

    fixture.componentInstance.label.set('Seconda etichetta');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(content().getAttribute('aria-label')).toBe('Seconda etichetta');

    fixture.componentInstance.label.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(content().getAttribute('aria-label')).toBe('Editor di codice');

    TestBed.inject(TranslocoService).setActiveLang('en');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(content().getAttribute('aria-label')).toBe('Code editor');
  });
});
