import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCog, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiInput } from '../ui/ui-input/ui-input';
import { UiSwitch } from '../ui/ui-switch/ui-switch';
import { DesktopService, type WorkspaceInfo, type WorkspacePatch } from './desktop.service';
import { ToastService } from '../ui/ui-toast/ui-toast';

/** Validazione porta: intero in [1024, 65535]. Restituisce una chiave i18n (o null se valida). */
function validatePort(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return 'workspaceSettings.portRequired';
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return 'workspaceSettings.portInteger';
  if (n < 1024 || n > 65535) return 'workspaceSettings.portRange';
  return null;
}

/** Validazione backend URL: vuoto (= solo mock) oppure URL assoluto http/https. Chiave i18n o null. */
function validateBackendUrl(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'workspaceSettings.backendUrlInvalid';
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'workspaceSettings.backendUrlInvalid';
}

/** Validazione intero >= min (0 ammette lo zero, 1 richiede un positivo). Chiave i18n o null. */
function validateInt(value: string, min: 0 | 1): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return 'workspaceSettings.numberRequired';
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return 'workspaceSettings.numberInteger';
  if (n < min) return min === 0 ? 'workspaceSettings.numberNonNegative' : 'workspaceSettings.numberPositive';
  return null;
}

/**
 * Dialog "Impostazioni workspace" (app desktop): il **titolo** (condiviso, in git) e — locali
 * per-workspace — **porta**, **backend URL** e le opzioni di **comportamento** del motore (filtri
 * case-insensitive, proxy fallback, latenza simulata, timeout) e di **ritenzione dei dump del
 * monitor**. Al salvataggio le modifiche vengono applicate e la finestra si ricarica (il motore
 * riparte, gestito dal processo principale). La cartella è in sola lettura.
 */
@Component({
  selector: 'app-workspace-settings-dialog',
  imports: [NgIcon, UiButton, UiInput, UiSwitch, TranslocoPipe],
  providers: [provideIcons({ lucideCheck, lucideCog, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex w-[min(70vw,800px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideCog" size="0.95rem" /></span>
        <div class="min-w-0 leading-tight">
          <h2 class="text-[15px] font-bold tracking-tight">{{ 'workspaceSettings.title' | transloco }}</h2>
          <p class="truncate font-mono text-[11px] text-muted-foreground" [title]="data.root">{{ data.name }}</p>
        </div>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex max-h-[68vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.folder' | transloco }}</label>
          <p class="break-all font-mono text-[12px] text-muted-foreground">{{ data.root }}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.titleLabel' | transloco }}</label>
          <input
            ui-input
            type="text"
            class="text-[13px]"
            [value]="title()"
            [placeholder]="defaultName"
            (input)="title.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.titleHint' | transloco: { name: defaultName } }}</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.port' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-40 font-mono text-[13px]"
            min="1024"
            max="65535"
            [value]="port()"
            (input)="port.set($any($event.target).value); saveError.set(null)"
            (keydown.enter)="save()"
          />
          @if (portError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ portError()! | transloco }}</span>
          } @else if (saveError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ saveError() }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.portHint' | transloco }}</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.backendUrl' | transloco }}</label>
          <input
            ui-input
            type="text"
            class="font-mono text-[13px]"
            placeholder="http://localhost:8080"
            [value]="backendUrl()"
            (input)="backendUrl.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (backendUrlError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ backendUrlError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.backendUrlHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.exposeNetwork' | transloco }}</label>
            <ui-switch [checked]="exposeToNetwork()" (checkedChange)="exposeToNetwork.set($event)" size="sm" [ariaLabel]="'workspaceSettings.exposeNetwork' | transloco" />
          </div>
          @if (exposeToNetwork()) {
          <span class="text-[11.5px] font-semibold text-destructive-soft">{{ 'workspaceSettings.exposeNetworkWarning' | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.exposeNetworkHint' | transloco }}</span>
        </div>

        <div class="border-t border-border pt-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ 'workspaceSettings.behaviorSection' | transloco }}</div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.caseInsensitiveFilters' | transloco }}</label>
            <ui-switch [checked]="caseInsensitiveFilters()" (checkedChange)="caseInsensitiveFilters.set($event)" size="sm" [ariaLabel]="'workspaceSettings.caseInsensitiveFilters' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.caseInsensitiveFiltersHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.proxyFallback' | transloco }}</label>
            <ui-switch [checked]="proxyFallbackEnabled()" (checkedChange)="proxyFallbackEnabled.set($event)" size="sm" [ariaLabel]="'workspaceSettings.proxyFallback' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.proxyFallbackHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.cors' | transloco }}</label>
            <ui-switch [checked]="corsEnabled()" (checkedChange)="corsEnabled.set($event)" size="sm" [ariaLabel]="'workspaceSettings.cors' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.corsHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.adaptCookies' | transloco }}</label>
            <ui-switch [checked]="adaptProxyCookies()" (checkedChange)="adaptProxyCookies.set($event)" size="sm" [ariaLabel]="'workspaceSettings.adaptCookies' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.adaptCookiesHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.rewriteRedirects' | transloco }}</label>
            <ui-switch [checked]="rewriteProxyRedirects()" (checkedChange)="rewriteProxyRedirects.set($event)" size="sm" [ariaLabel]="'workspaceSettings.rewriteRedirects' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.rewriteRedirectsHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.globalDelay' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-40 font-mono text-[13px]"
            min="0"
            [value]="globalDelayMs()"
            (input)="globalDelayMs.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (globalDelayError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ globalDelayError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.globalDelayHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.delayAll' | transloco }}</label>
            <ui-switch [checked]="delayAllRequests()" (checkedChange)="delayAllRequests.set($event)" size="sm" [ariaLabel]="'workspaceSettings.delayAll' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.delayAllHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.requestTimeout' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-40 font-mono text-[13px]"
            min="1"
            [value]="requestTimeoutMs()"
            (input)="requestTimeoutMs.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (requestTimeoutError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ requestTimeoutError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.requestTimeoutHint' | transloco }}</span>
        </div>

        <div class="border-t border-border pt-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ 'workspaceSettings.monitorSection' | transloco }}</div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.monitorDumpInterval' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-40 font-mono text-[13px]"
            min="1"
            [value]="monitorDumpIntervalMs()"
            (input)="monitorDumpIntervalMs.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (monitorDumpIntervalError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ monitorDumpIntervalError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.monitorDumpIntervalHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.monitorDumpThreshold' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-40 font-mono text-[13px]"
            min="1"
            [value]="monitorDumpThreshold()"
            (input)="monitorDumpThreshold.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (monitorDumpThresholdError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ monitorDumpThresholdError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.monitorDumpThresholdHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.monitorDumpMaxFile' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-56 font-mono text-[13px]"
            min="1"
            [value]="monitorDumpMaxFileBytes()"
            (input)="monitorDumpMaxFileBytes.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (monitorDumpMaxFileError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ monitorDumpMaxFileError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.monitorDumpMaxFileHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'workspaceSettings.monitorDumpMaxTotal' | transloco }}</label>
          <input
            ui-input
            type="number"
            class="w-56 font-mono text-[13px]"
            min="0"
            [value]="monitorDumpMaxTotalBytes()"
            (input)="monitorDumpMaxTotalBytes.set($any($event.target).value)"
            (keydown.enter)="save()"
          />
          @if (monitorDumpMaxTotalError()) {
          <span class="text-[11.5px] text-destructive-soft">{{ monitorDumpMaxTotalError()! | transloco }}</span>
          }
          <span class="text-[11.5px] text-muted-foreground">{{ 'workspaceSettings.monitorDumpMaxTotalHint' | transloco }}</span>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()">{{ 'workspaceSettings.cancel' | transloco }}</button>
        <button ui-button (click)="save()" [disabled]="!canSave() || saving()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ saving() ? ('workspaceSettings.saving' | transloco) : ('workspaceSettings.save' | transloco) }}</button>
      </div>
    </div>
  `,
})
export class WorkspaceSettingsDialog {
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<WorkspaceInfo>(DIALOG_DATA);
  private readonly desktop = inject(DesktopService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  // Nome della cartella (basename, multipiattaforma): è il default quando non c'è un titolo.
  protected readonly defaultName =
    this.data.root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || this.data.name;

  protected readonly title = signal(this.data.title ?? '');
  protected readonly port = signal(this.data.port != null ? String(this.data.port) : '');
  protected readonly portError = computed(() => validatePort(this.port()));
  protected readonly backendUrl = signal(this.data.backendUrl ?? '');
  protected readonly backendUrlError = computed(() => validateBackendUrl(this.backendUrl()));
  // host: scelta binaria loopback (127.0.0.1) vs tutta la rete (0.0.0.0), a rischio dell'utente.
  protected readonly exposeToNetwork = signal(this.data.host === '0.0.0.0');
  private readonly currentHost = computed(() => (this.exposeToNetwork() ? '0.0.0.0' : '127.0.0.1'));

  // Comportamento del motore (impostazioni locali per-workspace). I valori arrivano già effettivi
  // dal processo principale (workspace:get applica i default del motore): qui nessun default proprio.
  protected readonly caseInsensitiveFilters = signal(this.data.caseInsensitiveFilters);
  protected readonly proxyFallbackEnabled = signal(this.data.proxyFallbackEnabled);
  protected readonly corsEnabled = signal(this.data.corsEnabled);
  protected readonly adaptProxyCookies = signal(this.data.adaptProxyCookies);
  protected readonly rewriteProxyRedirects = signal(this.data.rewriteProxyRedirects);
  protected readonly globalDelayMs = signal(String(this.data.globalDelayMs));
  protected readonly globalDelayError = computed(() => validateInt(this.globalDelayMs(), 0));
  protected readonly delayAllRequests = signal(this.data.delayAllRequests);
  protected readonly requestTimeoutMs = signal(String(this.data.requestTimeoutMs));
  protected readonly requestTimeoutError = computed(() => validateInt(this.requestTimeoutMs(), 1));

  // Ritenzione dei dump del monitor (locali per-workspace).
  protected readonly monitorDumpIntervalMs = signal(String(this.data.monitorDumpIntervalMs));
  protected readonly monitorDumpIntervalError = computed(() => validateInt(this.monitorDumpIntervalMs(), 1));
  protected readonly monitorDumpThreshold = signal(String(this.data.monitorDumpThreshold));
  protected readonly monitorDumpThresholdError = computed(() => validateInt(this.monitorDumpThreshold(), 1));
  protected readonly monitorDumpMaxFileBytes = signal(String(this.data.monitorDumpMaxFileBytes));
  protected readonly monitorDumpMaxFileError = computed(() => validateInt(this.monitorDumpMaxFileBytes(), 1));
  protected readonly monitorDumpMaxTotalBytes = signal(String(this.data.monitorDumpMaxTotalBytes));
  protected readonly monitorDumpMaxTotalError = computed(() => validateInt(this.monitorDumpMaxTotalBytes(), 0));

  private readonly titleChanged = computed(() => this.title().trim() !== (this.data.title ?? ''));
  private readonly portChanged = computed(() => Number(this.port()) !== this.data.port);
  private readonly backendUrlChanged = computed(() => this.backendUrl().trim() !== (this.data.backendUrl ?? ''));
  private readonly hostChanged = computed(() => this.currentHost() !== this.data.host);
  private readonly caseInsensitiveFiltersChanged = computed(
    () => this.caseInsensitiveFilters() !== this.data.caseInsensitiveFilters,
  );
  private readonly proxyFallbackChanged = computed(
    () => this.proxyFallbackEnabled() !== this.data.proxyFallbackEnabled,
  );
  private readonly corsChanged = computed(() => this.corsEnabled() !== this.data.corsEnabled);
  private readonly adaptCookiesChanged = computed(
    () => this.adaptProxyCookies() !== this.data.adaptProxyCookies,
  );
  private readonly rewriteRedirectsChanged = computed(
    () => this.rewriteProxyRedirects() !== this.data.rewriteProxyRedirects,
  );
  private readonly globalDelayChanged = computed(() => Number(this.globalDelayMs()) !== this.data.globalDelayMs);
  private readonly delayAllChanged = computed(() => this.delayAllRequests() !== this.data.delayAllRequests);
  private readonly requestTimeoutChanged = computed(
    () => Number(this.requestTimeoutMs()) !== this.data.requestTimeoutMs,
  );
  private readonly monitorDumpIntervalChanged = computed(
    () => Number(this.monitorDumpIntervalMs()) !== this.data.monitorDumpIntervalMs,
  );
  private readonly monitorDumpThresholdChanged = computed(
    () => Number(this.monitorDumpThreshold()) !== this.data.monitorDumpThreshold,
  );
  private readonly monitorDumpMaxFileChanged = computed(
    () => Number(this.monitorDumpMaxFileBytes()) !== this.data.monitorDumpMaxFileBytes,
  );
  private readonly monitorDumpMaxTotalChanged = computed(
    () => Number(this.monitorDumpMaxTotalBytes()) !== this.data.monitorDumpMaxTotalBytes,
  );

  // Tutti i campi numerici sono validi (nessun errore) e almeno un campo è cambiato.
  private readonly numbersValid = computed(
    () =>
      this.portError() === null &&
      this.globalDelayError() === null &&
      this.requestTimeoutError() === null &&
      this.monitorDumpIntervalError() === null &&
      this.monitorDumpThresholdError() === null &&
      this.monitorDumpMaxFileError() === null &&
      this.monitorDumpMaxTotalError() === null,
  );
  private readonly anyChanged = computed(
    () =>
      this.titleChanged() ||
      this.portChanged() ||
      this.backendUrlChanged() ||
      this.hostChanged() ||
      this.caseInsensitiveFiltersChanged() ||
      this.proxyFallbackChanged() ||
      this.corsChanged() ||
      this.adaptCookiesChanged() ||
      this.rewriteRedirectsChanged() ||
      this.globalDelayChanged() ||
      this.delayAllChanged() ||
      this.requestTimeoutChanged() ||
      this.monitorDumpIntervalChanged() ||
      this.monitorDumpThresholdChanged() ||
      this.monitorDumpMaxFileChanged() ||
      this.monitorDumpMaxTotalChanged(),
  );
  protected readonly canSave = computed(
    () => this.numbersValid() && this.backendUrlError() === null && this.anyChanged(),
  );

  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    const patch: WorkspacePatch = {};
    if (this.titleChanged()) patch.name = this.title().trim();
    if (this.portChanged()) patch.port = Number(this.port());
    if (this.backendUrlChanged()) patch.backendUrl = this.backendUrl().trim();
    if (this.hostChanged()) patch.host = this.currentHost();
    if (this.caseInsensitiveFiltersChanged()) patch.caseInsensitiveFilters = this.caseInsensitiveFilters();
    if (this.proxyFallbackChanged()) patch.proxyFallbackEnabled = this.proxyFallbackEnabled();
    if (this.corsChanged()) patch.corsEnabled = this.corsEnabled();
    if (this.adaptCookiesChanged()) patch.adaptProxyCookies = this.adaptProxyCookies();
    if (this.rewriteRedirectsChanged()) patch.rewriteProxyRedirects = this.rewriteProxyRedirects();
    if (this.globalDelayChanged()) patch.globalDelayMs = Number(this.globalDelayMs());
    if (this.delayAllChanged()) patch.delayAllRequests = this.delayAllRequests();
    if (this.requestTimeoutChanged()) patch.requestTimeoutMs = Number(this.requestTimeoutMs());
    if (this.monitorDumpIntervalChanged()) patch.monitorDumpIntervalMs = Number(this.monitorDumpIntervalMs());
    if (this.monitorDumpThresholdChanged()) patch.monitorDumpThreshold = Number(this.monitorDumpThreshold());
    if (this.monitorDumpMaxFileChanged()) patch.monitorDumpMaxFileBytes = Number(this.monitorDumpMaxFileBytes());
    if (this.monitorDumpMaxTotalChanged()) patch.monitorDumpMaxTotalBytes = Number(this.monitorDumpMaxTotalBytes());

    this.saving.set(true);
    this.saveError.set(null);
    const result = await this.desktop.updateWorkspace(this.data.root, patch);

    // Porta occupata: il processo principale non ha cambiato nulla né ricaricato. Avvisa e resta aperta.
    if (result?.ok === false && result.error === 'port-in-use') {
      this.saving.set(false);
      const description = this.transloco.translate('workspaceSettings.portInUse', { port: result.port });
      this.saveError.set(description);
      this.toast.show({ tone: 'error', title: this.transloco.translate('workspaceSettings.portUnavailable'), description });
      return;
    }

    // Successo: la finestra si ricarica (gestito dal processo principale).
    this.dialogRef.close('saved');
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
