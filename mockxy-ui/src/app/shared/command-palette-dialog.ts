import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideCornerDownLeft, lucideDatabase, lucideFileJson, lucideListTree, lucideSearch, lucideToggleLeft } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiInput } from '../ui/ui-input/ui-input';
import { UiKbd } from '../ui/ui-kbd/ui-kbd';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ServerStatusStore } from './server-status.store';
import { MonitorStreamStore } from './monitor-stream.store';
import { MonitorDumpStore } from './monitor-dump.store';
import type { MockSummary } from '../mock-admin-api.types';

type CommandGroup = 'view' | 'runtime' | 'endpoint';

interface Command {
  readonly id: string;
  readonly group: CommandGroup;
  readonly label: string;
  /** Testo secondario: lo stato per i comandi runtime, il metodo per gli endpoint. */
  readonly hint?: string;
  readonly icon?: string;
  readonly run: () => void;
}

/**
 * Palette dei comandi: un campo, un elenco, invio.
 *
 * Copre le tre cose che altrimenti costano una traversata della UI: saltare a un endpoint per
 * percorso, commutare uno stato runtime, cambiare view. Gli endpoint si chiedono al motore
 * all'apertura invece di leggerli da uno store di pagina: la palette vive nella shell e deve
 * funzionare anche da Monitor o Dati, dove il catalogo non è montato.
 */
@Component({
  selector: 'app-command-palette-dialog',
  imports: [NgIcon, TranslocoPipe, UiInput, UiKbd],
  providers: [provideIcons({ lucideActivity, lucideCornerDownLeft, lucideDatabase, lucideFileJson, lucideListTree, lucideSearch, lucideToggleLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <div
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'palette.title' | transloco"
      class="flex max-h-[70vh] w-[min(92vw,640px)] flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-2xl"
    >
      <label class="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        <ng-icon name="lucideSearch" size="1rem" class="shrink-0 text-muted-foreground" />
        <input
          #field
          ui-input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="palette-list"
          [attr.aria-activedescendant]="activeId()"
          class="border-0 bg-transparent px-0 py-0 text-[14px] focus:ring-0"
          [placeholder]="'palette.placeholder' | transloco"
          [value]="query()"
          (input)="onQuery($any($event.target).value)"
        />
      </label>

      <div id="palette-list" role="listbox" [attr.aria-label]="'palette.title' | transloco" class="min-h-0 flex-1 overflow-y-auto p-1.5 mx-scroll">
        @for (group of groups(); track group.key) {
        <div class="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {{ group.labelKey | transloco }}
        </div>
        @for (command of group.commands; track command.id) {
        <button
          type="button"
          role="option"
          [id]="'palette-opt-' + command.id"
          [attr.aria-selected]="command.id === active()?.id"
          class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition"
          [class]="command.id === active()?.id ? 'bg-accent text-foreground' : 'text-foreground/85 hover:bg-accent/60'"
          (click)="execute(command)"
          (mouseenter)="activeIndex.set(flat().indexOf(command))"
        >
          @if (command.icon) {
          <ng-icon [name]="command.icon" size="0.9rem" class="shrink-0 text-muted-foreground" />
          }
          <span class="min-w-0 flex-1 truncate" [class.font-mono]="command.group === 'endpoint'">{{ command.label }}</span>
          @if (command.hint) {
          <span class="shrink-0 font-mono text-[11px] text-muted-foreground">{{ command.hint }}</span>
          }
        </button>
        }
        }
        @if (flat().length === 0) {
        <p class="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
          {{ (loadingEndpoints() ? 'palette.loading' : 'palette.noMatch') | transloco }}
        </p>
        }
      </div>

      <div class="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span class="inline-flex items-center gap-1.5"><ui-kbd>↑</ui-kbd><ui-kbd>↓</ui-kbd>{{ 'palette.hintMove' | transloco }}</span>
        <span class="inline-flex items-center gap-1.5"><ui-kbd><ng-icon name="lucideCornerDownLeft" size="0.65rem" /></ui-kbd>{{ 'palette.hintRun' | transloco }}</span>
        <span class="inline-flex items-center gap-1.5"><ui-kbd>Esc</ui-kbd>{{ 'palette.hintClose' | transloco }}</span>
      </div>
    </div>
  `,
})
export class CommandPaletteDialog {
  private readonly dialogRef = inject<DialogRef<unknown>>(DialogRef);
  private readonly router = inject(Router);
  private readonly api = inject(MockAdminApiService);
  private readonly transloco = inject(TranslocoService);
  private readonly server = inject(ServerStatusStore);
  private readonly stream = inject(MonitorStreamStore);
  private readonly dump = inject(MonitorDumpStore);

  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  private readonly endpoints = signal<readonly MockSummary[]>([]);
  /** L'elenco degli endpoint arriva via HTTP: finché non c'è, «nessun comando» sarebbe falso. */
  protected readonly loadingEndpoints = signal(true);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    // L'elenco arriva dal motore, non da uno store di pagina: la palette si apre da ogni view.
    this.api.listMocks().subscribe({
      next: (res) => this.endpoints.set(res.items),
      error: () => this.endpoints.set([]),
      complete: () => this.loadingEndpoints.set(false),
    });
  }

  private readonly viewCommands = computed<readonly Command[]>(() => [
    { id: 'view-mocks', group: 'view', icon: 'lucideListTree', label: this.transloco.translate('viewRail.catalogo'), run: () => this.go('/mocks') },
    { id: 'view-monitor', group: 'view', icon: 'lucideActivity', label: this.transloco.translate('viewRail.monitor'), run: () => this.go('/monitor') },
    { id: 'view-storico', group: 'view', icon: 'lucideDatabase', label: this.transloco.translate('viewRail.storico'), run: () => this.go('/storico') },
    { id: 'view-dati', group: 'view', icon: 'lucideFileJson', label: this.transloco.translate('viewRail.dati'), run: () => this.go('/dati') },
  ]);

  private readonly runtimeCommands = computed<readonly Command[]>(() => {
    const t = (key: string) => this.transloco.translate(key);
    const commands: Command[] = [
      {
        id: 'runtime-server',
        group: 'runtime',
        icon: 'lucideToggleLeft',
        label: t(this.server.serverEnabled() ? 'palette.serverOff' : 'palette.serverOn'),
        hint: t(this.server.serverEnabled() ? 'runtimeStatus.serverOn' : 'runtimeStatus.serverOff'),
        run: () => this.server.setServerEnabled(!this.server.serverEnabled()),
      },
      {
        id: 'runtime-proxy',
        group: 'runtime',
        icon: 'lucideToggleLeft',
        label: t(this.server.proxyAll() ? 'palette.proxyOff' : 'palette.proxyOn'),
        hint: t(this.server.proxyAll() ? 'runtimeStatus.proxyAllOn' : 'runtimeStatus.proxyAllOff'),
        run: () => this.server.setProxyAll(!this.server.proxyAll()),
      },
      {
        id: 'runtime-monitor',
        group: 'runtime',
        icon: 'lucideActivity',
        label: t(this.stream.streaming() ? 'palette.monitorPause' : 'palette.monitorResume'),
        hint: t(this.stream.streaming() ? 'runtimeStatus.live' : 'runtimeStatus.paused'),
        run: () => this.stream.setStreaming(!this.stream.streaming()),
      },
    ];
    if (this.dump.available()) {
      commands.push({
        id: 'runtime-dump',
        group: 'runtime',
        icon: 'lucideDatabase',
        label: t(this.dump.enabled() ? 'palette.dumpOff' : 'palette.dumpOn'),
        hint: t(this.dump.enabled() ? 'runtimeStatus.dumpOn' : 'runtimeStatus.dumpOff'),
        run: () => this.dump.setEnabled(!this.dump.enabled()),
      });
      if (this.dump.enabled()) {
        commands.push({ id: 'runtime-flush', group: 'runtime', icon: 'lucideDatabase', label: t('palette.flush'), run: () => this.dump.flush() });
      }
    }
    return commands;
  });

  private readonly endpointCommands = computed<readonly Command[]>(() =>
    this.endpoints().map((item) => ({
      id: `endpoint-${item.id}`,
      group: 'endpoint' as const,
      label: item.path,
      hint: item.method,
      run: () => this.go('/mocks', { m: item.method, p: item.path }),
    })),
  );

  /** Filtro unico su etichetta e suggerimento: "get users", "500", "monitor" pescano tutti. */
  private matches(command: Command, needle: string): boolean {
    if (needle === '') {
      return true;
    }
    const haystack = `${command.label} ${command.hint ?? ''}`.toLowerCase();
    return needle.split(/\s+/).every((token) => haystack.includes(token));
  }

  protected readonly groups = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const keep = (commands: readonly Command[]) => commands.filter((command) => this.matches(command, needle));
    return [
      { key: 'view' as const, labelKey: 'palette.groupViews', commands: keep(this.viewCommands()) },
      { key: 'runtime' as const, labelKey: 'palette.groupRuntime', commands: keep(this.runtimeCommands()) },
      { key: 'endpoint' as const, labelKey: 'palette.groupEndpoints', commands: keep(this.endpointCommands()) },
    ].filter((group) => group.commands.length > 0);
  });

  /** Elenco appiattito nell'ordine mostrato: è su questo che si muovono le frecce. */
  protected readonly flat = computed<readonly Command[]>(() => this.groups().flatMap((group) => group.commands));
  protected readonly active = computed<Command | undefined>(() => this.flat()[this.activeIndex()]);
  protected readonly activeId = computed(() => (this.active() ? `palette-opt-${this.active()!.id}` : null));

  protected onQuery(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const total = this.flat().length;
      if (total === 0) {
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex.set((this.activeIndex() + step + total) % total);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = this.active();
      if (command) {
        this.execute(command);
      }
    }
  }

  protected execute(command: Command): void {
    command.run();
    this.dialogRef.close();
  }

  /**
   * I salti agli endpoint passano da `?m=&p=`, il contratto che il catalogo già espone per il
   * "vai al mock" del monitor: nessuna via nuova da mantenere.
   */
  private go(path: string, queryParams?: Record<string, string>): void {
    void this.router.navigate([path], queryParams ? { queryParams } : {});
  }
}
