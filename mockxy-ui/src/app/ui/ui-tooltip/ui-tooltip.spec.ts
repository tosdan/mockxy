import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiTooltip } from './ui-tooltip';

@Component({
  imports: [UiTooltip],
  template: `@if (shown()) { <button type="button" uiTooltip="Rinomina il file" [showDelay]="150">x</button> }`,
})
class Host {
  readonly shown = signal(true);
}

describe('UiTooltip', () => {
  const tooltips = () => document.querySelectorAll('.cdk-overlay-container [role="tooltip"]').length;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function create() {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const button = () => (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, button };
  }

  it('si apre dopo il ritardo, al passaggio del mouse', () => {
    const { button } = create();
    button().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    expect(tooltips()).toBe(1);
  });

  // Il clic su un pulsante che sparisce porta insieme hover e fuoco: due timer d'apertura. Prima il
  // secondo sovrascriveva il primo, che restava attivo e apriva il tooltip a pulsante distrutto,
  // nell'angolo in alto a sinistra e senza piu' nessuno a chiuderlo.
  it('hover e fuoco insieme, poi il pulsante sparisce: nessun tooltip orfano', () => {
    const { fixture, button } = create();
    button().dispatchEvent(new MouseEvent('mouseenter'));
    button().dispatchEvent(new FocusEvent('focusin'));
    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    vi.advanceTimersByTime(500);
    expect(tooltips()).toBe(0);
  });

  it('non si apre su un pulsante staccato dalla pagina', () => {
    const { button } = create();
    const host = button();
    host.dispatchEvent(new MouseEvent('mouseenter'));
    host.remove();
    vi.advanceTimersByTime(500);
    expect(tooltips()).toBe(0);
  });
});
