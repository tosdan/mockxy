import '@angular/compiler';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiPageHeader } from './ui-page-header';

@Component({
  imports: [UiPageHeader],
  template: `
    <ui-page-header title="Storico">
      <span class="count">12</span>
      <button actions type="button">Azione</button>
    </ui-page-header>
  `,
})
class Host {}

describe('UiPageHeader', () => {
  it('titolo come intestazione di pagina, contenuto accanto, azioni in fondo a destra', () => {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const heading = host.querySelector('h1');
    expect(heading?.textContent?.trim()).toBe('Storico');
    // Il contenuto segue il titolo; le azioni stanno nel gruppo spinto a destra.
    expect(heading?.nextElementSibling?.classList.contains('count')).toBe(true);
    const actions = host.querySelector('button')?.parentElement;
    expect(actions?.classList.contains('ml-auto')).toBe(true);
    expect(actions?.contains(host.querySelector('.count'))).toBe(false);
  });
});
