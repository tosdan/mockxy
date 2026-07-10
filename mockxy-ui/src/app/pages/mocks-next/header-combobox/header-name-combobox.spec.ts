import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HeaderNameCombobox } from './header-name-combobox';
import { translocoTesting } from '../../../testing/transloco-testing';

describe('HeaderNameCombobox', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderNameCombobox, translocoTesting()],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  function create(initial = '') {
    const fixture = TestBed.createComponent(HeaderNameCombobox);
    const component = fixture.componentInstance;
    component.value.set(initial);
    fixture.detectChanges();
    // I membri protected si raggiungono via cast: lo spec verifica il comportamento, non l'incapsulamento.
    return { fixture, component, api: component as any };
  }

  it('col filtro vuoto mostra tutti gli header comuni', () => {
    const { api } = create();
    expect(api.suggestions().length).toBeGreaterThan(10);
    expect(api.suggestions()).toContain('Content-Type');
  });

  it('filtra per prefisso/sottostringa, case-insensitive', () => {
    const { api } = create();
    api.onInput('content');
    const s = api.suggestions();
    expect(s).toContain('Content-Type');
    expect(s).toContain('Content-Length');
    expect(s).not.toContain('ETag');
  });

  it('resta free-solo: un nome custom digitato è il valore committato', () => {
    const { component, api } = create();
    api.onInput('X-Custom-Header');
    expect(component.value()).toBe('X-Custom-Header');
  });

  it('committa il nome quando si seleziona un suggerimento', () => {
    const { component, api } = create();
    api.selectOption('ETag');
    expect(component.value()).toBe('ETag');
    expect(api.open()).toBe(false);
  });

  it('lista vuota per una query senza match', () => {
    const { api } = create();
    api.onInput('zzzz-nope');
    expect(api.suggestions()).toEqual([]);
  });

  it('Tab conferma il suggerimento evidenziato e chiude', () => {
    const { component, api } = create();
    api.onInput('etag'); // suggerimenti = [ETag], primo evidenziato
    api.onKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(component.value()).toBe('ETag');
    expect(api.open()).toBe(false);
  });
});
