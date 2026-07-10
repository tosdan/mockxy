import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  type OnDestroy,
  afterNextRender,
  computed,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
import { cn } from '../cn';
import {
  jsonLinterExtension,
  languageExtension,
  sizeTheme,
  staticExtensions,
  type EditorLanguage,
} from './cm-setup';

/**
 * Editor di codice editabile, basato su CodeMirror 6. Mantiene l'interfaccia di prima ([(value)],
 * disabled, invalid, placeholder, ariaLabel, minRows, maxRows) e aggiunge `language` per scegliere
 * il linguaggio: JSON per i mock, JavaScript per handler/middleware. Porta evidenziazione della
 * sintassi, numeri di riga, parentesi abbinate/auto-chiuse, ripiegamento, annulla/ripeti e — sul
 * JSON — lint inline. La validazione che governa il salvataggio resta nel consumatore, che pilota
 * `invalid` per l'anello d'errore (qui il bordo lo disegna l'involucro, non CodeMirror).
 */
@Component({
  selector: 'ui-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host [class]="hostClass()" [attr.aria-invalid]="invalid() ? 'true' : null"></div>`,
})
export class UiCodeEditor implements OnDestroy {
  /** Testo, two-way: [(value)]. */
  readonly value = model('');
  readonly disabled = input(false);
  /** Mostra l'anello di errore sull'involucro (la validazione la fa il consumatore). */
  readonly invalid = input(false);
  readonly placeholder = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly minRows = input(6);
  readonly maxRows = input(40);
  /** Linguaggio dell'editor: governa evidenziazione e lint. */
  readonly language = input<EditorLanguage>('json');

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private view: EditorView | null = null;

  // Parti ricaricabili a runtime senza ricreare l'editor.
  private readonly languageConf = new Compartment();
  private readonly lintConf = new Compartment();
  private readonly readOnlyConf = new Compartment();
  private readonly sizeConf = new Compartment();
  private readonly placeholderConf = new Compartment();

  protected readonly hostClass = computed(() =>
    cn(
      'block w-full overflow-hidden rounded-lg bg-[var(--code)] ring-1 ring-border transition-shadow focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/50',
      this.invalid() && 'ring-destructive/60 focus-within:ring-destructive/60',
      this.disabled() && 'cursor-not-allowed opacity-60',
    ),
  );

  constructor() {
    // L'editor si crea dopo il primo render (serve l'elemento host nel DOM; solo nel browser).
    afterNextRender(() => this.createView());

    // Linguaggio (+ lint JSON solo quando serve).
    effect(() => {
      const lang = this.language();
      this.view?.dispatch({
        effects: [
          this.languageConf.reconfigure(languageExtension(lang)),
          this.lintConf.reconfigure(lang === 'json' ? jsonLinterExtension() : []),
        ],
      });
    });

    // Sola lettura quando disabilitato.
    effect(() => {
      const readOnly = this.disabled();
      this.view?.dispatch({ effects: this.readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)) });
    });

    // Placeholder.
    effect(() => {
      const text = this.placeholder();
      this.view?.dispatch({
        effects: this.placeholderConf.reconfigure(text ? cmPlaceholder(text) : []),
      });
    });

    // Altezza min/max.
    effect(() => {
      const min = this.minRows();
      const max = this.maxRows();
      this.view?.dispatch({ effects: this.sizeConf.reconfigure(sizeTheme(min, max)) });
    });

    // Valore "da fuori" (preset, rigenera template, cambio response) → riallinea il documento.
    // Quando la modifica nasce dall'editor, value() coincide già col documento, quindi non si fa nulla
    // (niente cicli).
    effect(() => {
      const next = this.value();
      const view = this.view;
      if (view && next !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      }
    });
  }

  private createView(): void {
    const state = EditorState.create({
      doc: this.value(),
      extensions: [
        ...staticExtensions,
        this.languageConf.of(languageExtension(this.language())),
        this.lintConf.of(this.language() === 'json' ? jsonLinterExtension() : []),
        this.readOnlyConf.of(EditorState.readOnly.of(this.disabled())),
        this.sizeConf.of(sizeTheme(this.minRows(), this.maxRows())),
        this.placeholderConf.of(this.placeholder() ? cmPlaceholder(this.placeholder()!) : []),
        EditorView.contentAttributes.of({
          'aria-label': this.ariaLabel() ?? 'Editor di codice',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.value.set(update.state.doc.toString());
          }
        }),
      ],
    });
    this.view = new EditorView({ state, parent: this.host().nativeElement });
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
