import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  type OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { cn } from '../cn';
import {
  editorPhrases,
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
  private readonly phrasesConf = new Compartment();
  private readonly ariaConf = new Compartment();

  /** Testi dell'editor nella lingua attiva: si aggiornano quando la lingua cambia. */
  private readonly translations = toSignal(inject(TranslocoService).selectTranslateObject<Record<string, string>>('codeEditor'), {
    initialValue: {} as Record<string, string>,
  });

  protected readonly hostClass = computed(() =>
    cn(
      'block w-full overflow-hidden rounded-lg bg-[var(--code)] ring-1 ring-border transition-shadow focus-within:outline-none focus-within:ring-2 focus-within:ring-ring/70',
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

    // Testi di CodeMirror (ricerca, lint, ripiegamento...) ed etichetta, nella lingua attiva. Si
    // leggono prima di guardare se l'editor c'e': al primo giro non c'e' ancora, e un ariaLabel letto
    // solo dentro il dispatch non diventerebbe una dipendenza, e i suoi cambi andrebbero persi.
    effect(() => {
      const phrases = editorPhrases(this.translations());
      const attributes = this.contentAttributes();
      this.view?.dispatch({ effects: [this.phrasesConf.reconfigure(phrases), this.ariaConf.reconfigure(attributes)] });
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

  // Attributi dell'area di testo; senza ariaLabel l'etichetta e' quella generica, tradotta.
  private contentAttributes() {
    return EditorView.contentAttributes.of({
      'aria-label': this.ariaLabel() ?? this.translations()['ariaLabel'] ?? 'Code editor',
      autocapitalize: 'off',
      autocorrect: 'off',
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
        this.phrasesConf.of(editorPhrases(this.translations())),
        this.ariaConf.of(this.contentAttributes()),
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
