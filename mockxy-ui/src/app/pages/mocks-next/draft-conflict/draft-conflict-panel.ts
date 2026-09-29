import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, untracked, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideRefreshCw, lucideTriangleAlert } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiCode } from '../../../ui/ui-code/ui-code';
import type { DraftConflictView } from './draft-guard';

let nextPanelId = 0;

/**
 * Gestione del conflitto di una bozza (piano agent/API, §13 C4), comune a descrizione, form della
 * variante e dialog sequence. Mostra il conflitto conservando il testo della bozza: «Confronta»
 * carica la versione corrente accanto, «Ricarica» la sostituisce alla bozza (con conferma se
 * modificata), «Salva la mia versione» salva contro la revisione appena mostrata. Con la risorsa
 * sparita il testo resta copiabile e il salvataggio è disabilitato dal padre.
 */
@Component({
  selector: 'mocks-next-draft-conflict',
  imports: [NgIcon, TranslocoPipe, UiButton, UiCode],
  providers: [provideIcons({ lucideCheck, lucideRefreshCw, lucideTriangleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Nessun box proprio: senza niente da mostrare non occupa spazio né un posto nei flex/gap del
  // padre, e la regione degli annunci resta montata.
  host: { class: 'contents' },
  template: `
    <!-- Regione sempre presente: un cambiamento visto dalla sincronizzazione arriva mentre si
         scrive e si annuncia senza spostare il focus. -->
    <p class="sr-only" aria-live="polite">@if (announcement(); as key) { {{ key | transloco }} }</p>
    @if (visible()) {
    <div [class]="panelClass()">
      @if (guard().blocked()) {
      <div role="alert" class="flex items-start gap-2.5 rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/[0.08] px-3.5 py-3 text-[12.5px]">
        <ng-icon name="lucideTriangleAlert" size="0.9rem" class="mt-0.5 shrink-0 text-destructive-soft" />
        <div class="flex flex-col gap-1">
          <p class="font-semibold text-foreground">{{ 'draftConflict.blockedTitle' | transloco }}</p>
          <p class="text-muted-foreground">{{ 'draftConflict.blockedHint' | transloco }}</p>
        </div>
      </div>
      } @else if (guard().missing()) {
      <div role="alert" class="flex items-start gap-2.5 rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/[0.08] px-3.5 py-3 text-[12.5px]">
        <ng-icon name="lucideTriangleAlert" size="0.9rem" class="mt-0.5 shrink-0 text-destructive-soft" />
        <div class="flex flex-col gap-1">
          <p class="font-semibold text-foreground">{{ 'draftConflict.missingTitle' | transloco }}</p>
          <p class="text-muted-foreground">{{ 'draftConflict.missingHint' | transloco }}</p>
        </div>
      </div>
      } @else if (guard().conflict() || guard().remoteChanged()) {
      <section
        #panel
        tabindex="-1"
        [attr.aria-labelledby]="headingId"
        [attr.aria-busy]="guard().loading()"
        class="flex flex-col gap-3 rounded-lg border border-[color:var(--status-4xx)]/30 bg-[color:var(--status-4xx)]/[0.10] px-3.5 py-3 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div class="flex items-start gap-2.5">
          <ng-icon name="lucideTriangleAlert" size="0.9rem" class="mt-0.5 shrink-0 text-[color:var(--status-4xx)]" />
          <div class="flex flex-col gap-1">
            @if (guard().conflict()) {
            <h3 [id]="headingId" class="font-semibold text-foreground">{{ 'draftConflict.title' | transloco }}</h3>
            <p class="text-muted-foreground">{{ 'draftConflict.hint' | transloco }}</p>
            } @else {
            <h3 [id]="headingId" class="font-semibold text-foreground">{{ 'draftConflict.remoteTitle' | transloco }}</h3>
            <p class="text-muted-foreground">{{ 'draftConflict.remoteHint' | transloco }}</p>
            }
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button ui-button variant="outline" size="sm" [disabled]="guard().loading()" (click)="guard().compare()">{{ 'draftConflict.compare' | transloco }}</button>
          <button #reloadButton ui-button variant="outline" size="sm" [disabled]="guard().loading()" (click)="guard().reload()">
            <ng-icon name="lucideRefreshCw" size="0.8rem" /> {{ 'draftConflict.reload' | transloco }}
          </button>
          @if (guard().remote(); as remote) {
          <button ui-button size="sm" [disabled]="busy() || guard().loading()" (click)="saveMine.emit(remote.revision)">
            <ng-icon name="lucideCheck" size="0.8rem" /> {{ 'draftConflict.saveMine' | transloco }}
          </button>
          }
        </div>
        @if (guard().confirmingReload()) {
        <div class="flex flex-wrap items-center gap-2" (keydown.escape)="cancelReload()">
          <span class="text-foreground">{{ 'draftConflict.reloadConfirm' | transloco }}</span>
          <button #confirmReloadButton ui-button variant="destructive" size="sm" (click)="guard().confirmReload()">{{ 'draftConflict.replace' | transloco }}</button>
          <button ui-button variant="outline" size="sm" (click)="cancelReload()">{{ 'draftConflict.keep' | transloco }}</button>
        </div>
        }
        @if (guard().loadError(); as message) {
        <p role="alert" class="whitespace-pre-line break-words text-destructive-soft">{{ message }}</p>
        }
        @if (guard().reloadUnsupported()) {
        <p role="alert" class="text-destructive-soft">{{ 'draftConflict.reloadUnsupported' | transloco }}</p>
        }
        @if (guard().remote(); as remote) {
        <div class="flex flex-col gap-2">
          <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'draftConflict.currentVersion' | transloco }}</p>
          @for (block of remote.blocks; track $index) {
          <div class="flex flex-col gap-1">
            <span class="font-mono text-[11px] text-muted-foreground">{{ block.label }}</span>
            <div class="max-h-64 overflow-y-auto rounded-md bg-[var(--code)] px-3 py-2 mx-scroll">
              <ui-code [code]="block.code" [language]="block.language" />
            </div>
          </div>
          }
        </div>
        }
      </section>
      } @else if (guard().reloaded()) {
      <p #reloadedNote tabindex="-1" role="status" class="rounded-lg px-1 text-[12.5px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        {{ 'draftConflict.reloaded' | transloco }}
      </p>
      }
    </div>
    }
  `,
})
export class MocksNextDraftConflict {
  readonly guard = input.required<DraftConflictView>();
  /** Un salvataggio è in corso: "Salva la mia versione" attende. */
  readonly busy = input(false);
  /** Margini e larghezza del pannello: senza niente da mostrare non occupa spazio. */
  readonly panelClass = input('');
  /** "Salva la mia versione": porta la revisione della versione appena mostrata. */
  readonly saveMine = output<string>();

  protected readonly headingId = `draft-conflict-${nextPanelId++}`;
  /** Chiave dell'annuncio del cambiamento visto dalla sincronizzazione (il focus resta dov'è). */
  protected readonly announcement = computed(() => {
    const guard = this.guard();
    return guard.remoteChanged() && !guard.conflict() && !guard.missing() && !guard.blocked() ? 'draftConflict.remoteTitle' : null;
  });
  protected readonly visible = computed(() => {
    const guard = this.guard();
    return guard.blocked() || guard.missing() || guard.conflict() != null || guard.remoteChanged() || guard.reloaded();
  });
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  // Sui pulsanti il riferimento è il componente ui-button: serve l'elemento per il focus.
  private readonly reloadButton = viewChild('reloadButton', { read: ElementRef<HTMLButtonElement> });
  private readonly confirmReloadButton = viewChild('confirmReloadButton', { read: ElementRef<HTMLButtonElement> });
  private readonly reloadedNote = viewChild<ElementRef<HTMLElement>>('reloadedNote');

  constructor() {
    // Il conflitto arriva da un salvataggio: il focus passa al pannello che lo spiega. Stessa
    // cosa per la conferma della ricarica e per l'esito, che prende il posto del pannello.
    effect(() => {
      const conflict = this.guard().conflict();
      const panel = this.panel();
      if (conflict && panel) untracked(() => panel.nativeElement.focus());
    });
    effect(() => this.confirmReloadButton()?.nativeElement.focus());
    effect(() => this.reloadedNote()?.nativeElement.focus());
  }

  protected cancelReload(): void {
    this.guard().cancelReload();
    this.reloadButton()?.nativeElement.focus();
  }
}
