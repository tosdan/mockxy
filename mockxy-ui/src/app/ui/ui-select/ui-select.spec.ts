import '@angular/compiler';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { UiSelect, type UiSelectOption } from './ui-select';
import { translocoTesting } from '../../testing/transloco-testing';

const OPTIONS: UiSelectOption[] = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma', accent: 'var(--type-mock)' },
];

function key(name: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: name, cancelable: true });
}

describe('UiSelect', () => {
  beforeEach(async () => {
    // jsdom non implementa scrollIntoView (usata per tenere a vista l'opzione attiva)
    Element.prototype.scrollIntoView = vi.fn();
    await TestBed.configureTestingModule({
      imports: [UiSelect, translocoTesting()],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  function create(inputs: Partial<{ options: UiSelectOption[]; value: string | null; disabled: boolean; tone: string; placeholder: string }> = {}) {
    const fixture: ComponentFixture<UiSelect<unknown>> = TestBed.createComponent(UiSelect);
    fixture.componentRef.setInput('options', inputs.options ?? OPTIONS);
    if (inputs.value !== undefined) fixture.componentRef.setInput('value', inputs.value);
    if (inputs.disabled !== undefined) fixture.componentRef.setInput('disabled', inputs.disabled);
    if (inputs.tone !== undefined) fixture.componentRef.setInput('tone', inputs.tone);
    if (inputs.placeholder !== undefined) fixture.componentRef.setInput('placeholder', inputs.placeholder);
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  describe('etichetta e trigger', () => {
    it('mostra la label del valore selezionato, o il placeholder', () => {
      const { c } = create({ value: 'c' });
      expect(c.selectedLabel()).toBe('Gamma');
      expect(c.selectedAccent()).toBe('var(--type-mock)');

      const senza = create({ value: null, placeholder: 'Scegli…' });
      expect(senza.c.selectedLabel()).toBeNull();
      expect(senza.c.displayPlaceholder()).toBe('Scegli…');
    });

    it('il tono status colora il trigger e accende il pallino', () => {
      const { c } = create({ tone: '4xx' });
      expect(c.triggerClass()).toContain('--status-4xx');
      expect(c.dotClass()).toContain('--status-4xx');
      const neutro = create();
      expect(neutro.c.dotClass()).toBe('');
    });
  });

  describe('apertura', () => {
    it('apre sull’opzione selezionata, o sulla prima abilitata', () => {
      const { c } = create({ value: 'c' });
      c.openPanel();
      expect(c.open()).toBe(true);
      expect(c.activeIndex()).toBe(2);

      const senza = create({ options: [{ value: 'x', label: 'X', disabled: true }, ...OPTIONS], value: null });
      senza.c.openPanel();
      expect(senza.c.activeIndex()).toBe(1); // salta la prima disabilitata
    });

    it('da disabilitata non si apre (né da tastiera)', () => {
      const { c } = create({ disabled: true });
      c.openPanel();
      expect(c.open()).toBe(false);
      c.onKeydown(key('ArrowDown'));
      expect(c.open()).toBe(false);
    });

    it('toggle apre e richiude', () => {
      const { c } = create();
      c.toggle();
      expect(c.open()).toBe(true);
      c.toggle();
      expect(c.open()).toBe(false);
    });
  });

  describe('navigazione da tastiera', () => {
    it('da chiusa, frecce/Enter/Spazio aprono il pannello', () => {
      for (const k of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
        const { c } = create({ value: 'a' });
        c.onKeydown(key(k));
        expect(c.open()).toBe(true);
      }
    });

    it('le frecce saltano le opzioni disabilitate e fanno il giro', () => {
      const { c } = create({ value: 'a' });
      c.openPanel(); // attiva = 0 (Alfa)
      c.onKeydown(key('ArrowDown'));
      expect(c.activeIndex()).toBe(2); // Beta è disabilitata → Gamma
      c.onKeydown(key('ArrowDown'));
      expect(c.activeIndex()).toBe(0); // wrap
      c.onKeydown(key('ArrowUp'));
      expect(c.activeIndex()).toBe(2); // wrap all'indietro saltando Beta
    });

    it('Home ed End vanno alla prima/ultima abilitata', () => {
      const { c } = create({ value: 'c' });
      c.openPanel();
      c.onKeydown(key('Home'));
      expect(c.activeIndex()).toBe(0);
      c.onKeydown(key('End'));
      expect(c.activeIndex()).toBe(2);
    });

    it('Enter seleziona l’opzione attiva, aggiorna il model e chiude', () => {
      const { c } = create({ value: 'a' });
      c.openPanel();
      c.onKeydown(key('ArrowDown')); // → Gamma
      c.onKeydown(key('Enter'));
      expect(c.value()).toBe('c');
      expect(c.open()).toBe(false);
    });

    it('Escape e Tab chiudono senza selezionare', () => {
      const esc = create({ value: 'a' });
      esc.c.openPanel();
      esc.c.onKeydown(key('Escape'));
      expect(esc.c.open()).toBe(false);
      expect(esc.c.value()).toBe('a');

      const tab = create({ value: 'a' });
      tab.c.openPanel();
      tab.c.onKeydown(key('Tab'));
      expect(tab.c.open()).toBe(false);
    });

    it('con tutte le opzioni disabilitate la navigazione non si blocca né seleziona', () => {
      const { c } = create({
        options: [
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B', disabled: true },
        ],
        value: null,
      });
      c.openPanel();
      const start = c.activeIndex();
      c.onKeydown(key('ArrowDown'));
      expect(c.activeIndex()).toBe(start); // nessuna abilitata → resta dov'era
      c.onKeydown(key('Enter'));
      expect(c.value()).toBeNull();
    });
  });

  describe('selezione e chiusure', () => {
    it('selectOption ignora le opzioni disabilitate', () => {
      const { c } = create({ value: 'a' });
      c.openPanel();
      c.selectOption(OPTIONS[1]); // Beta disabled
      expect(c.value()).toBe('a');
      expect(c.open()).toBe(true);
    });

    it('il click fuori chiude, ma un click sul trigger è lasciato a toggle()', () => {
      const { fixture, c } = create();
      c.openPanel();
      const trigger: HTMLElement = fixture.nativeElement.querySelector('button');
      c.onOutsideClick({ target: trigger } as unknown as MouseEvent);
      expect(c.open()).toBe(true); // ci pensa toggle, non l'outside click

      c.onOutsideClick({ target: document.body } as unknown as MouseEvent);
      expect(c.open()).toBe(false);
    });

    it('gli attributi ARIA seguono lo stato (combobox → listbox, activedescendant)', () => {
      const { fixture, c } = create({ value: 'a' });
      const trigger: HTMLElement = fixture.nativeElement.querySelector('[role=combobox]');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      c.openPanel();
      fixture.detectChanges();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(trigger.getAttribute('aria-controls')).toBe(c.listboxId);
      expect(trigger.getAttribute('aria-activedescendant')).toBe(c.optionId(0));
    });
  });
});
