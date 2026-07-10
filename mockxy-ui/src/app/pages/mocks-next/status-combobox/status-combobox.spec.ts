import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StatusCombobox, isValidStatus } from './status-combobox';
import type { HttpStatusCodeOption } from '../../../http-status-codes.service';
import { translocoTesting } from '../../../testing/transloco-testing';

describe('isValidStatus', () => {
  it('accetta interi 100–599 (anche fuori lista) e rifiuta il resto', () => {
    expect(isValidStatus(200)).toBe(true);
    expect(isValidStatus(100)).toBe(true);
    expect(isValidStatus(599)).toBe(true);
    expect(isValidStatus(299)).toBe(true); // codice arbitrario non tra i suggerimenti
    expect(isValidStatus(99)).toBe(false);
    expect(isValidStatus(600)).toBe(false);
    expect(isValidStatus(200.5)).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
  });
});

describe('StatusCombobox', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusCombobox, translocoTesting()],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  function create(initial: number | null = 200) {
    const fixture = TestBed.createComponent(StatusCombobox);
    const component = fixture.componentInstance;
    component.value.set(initial);
    fixture.detectChanges();
    // I membri protected si raggiungono via cast: lo spec verifica il comportamento, non l'incapsulamento.
    return { fixture, component, api: component as any };
  }

  it('mantiene free-solo: un codice digitato a mano resta il valore numerico committato', () => {
    const { component, api } = create();
    api.onInput('299');
    expect(component.value()).toBe(299);
    expect(api.invalid()).toBe(false);
  });

  it('tratta il campo vuoto come null e invalido', () => {
    const { component, api } = create();
    api.onInput('');
    expect(component.value()).toBeNull();
    expect(api.invalid()).toBe(true);
  });

  it('committa comunque il numero ma segnala invalido fuori dal range', () => {
    const { component, api } = create();
    api.onInput('700');
    expect(component.value()).toBe(700);
    expect(api.invalid()).toBe(true);
  });

  it('filtra i suggerimenti per codice', () => {
    const { api } = create();
    api.onInput('50');
    const codes = api.suggestions().map((option: HttpStatusCodeOption) => option.code);
    expect(codes).toContain(500);
    expect(codes).toContain(503);
    expect(codes).not.toContain(200);
  });

  it('filtra i suggerimenti per descrizione testuale', () => {
    const { api } = create();
    api.onInput('gateway');
    expect(api.suggestions().map((option: HttpStatusCodeOption) => option.code)).toEqual([502, 504]);
  });

  it('committa il codice quando si seleziona un suggerimento', () => {
    const { component, api } = create();
    const option: HttpStatusCodeOption = { code: 404, description: 'Not Found', label: '404 Not Found' };
    api.selectOption(option);
    expect(component.value()).toBe(404);
    expect(api.text()).toBe('404 Not Found');
  });

  it('espone la fascia (tone) corretta per la pill colorata', () => {
    const { component, api } = create();
    expect(api.tone()).toBe('2xx'); // 200
    component.value.set(302);
    expect(api.tone()).toBe('3xx');
    component.value.set(404);
    expect(api.tone()).toBe('4xx');
    component.value.set(503);
    expect(api.tone()).toBe('5xx');
    component.value.set(700); // fuori range → neutro
    expect(api.tone()).toBe('default');
  });

  it('conferma il suggerimento evidenziato con Tab e chiude la tendina', () => {
    const { component, api } = create();
    api.onInput('gateway'); // suggerimenti [502, 504], il primo è evidenziato
    api.onKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(component.value()).toBe(502);
    expect(api.open()).toBe(false);
  });

  it('con Tab senza suggerimenti mantiene il valore free-solo digitato', () => {
    const { component, api } = create();
    api.onInput('999'); // nessun codice/descrizione corrisponde → lista vuota
    api.onKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(component.value()).toBe(999);
    expect(api.open()).toBe(false);
  });

  it('riallinea il testo dell\'input quando il valore cambia da fuori', async () => {
    const { fixture, component, api } = create(200);
    expect(api.text()).toBe('200 OK');

    component.value.set(503);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.text()).toBe('503 Service Unavailable');
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('503 Service Unavailable');
  });
});
