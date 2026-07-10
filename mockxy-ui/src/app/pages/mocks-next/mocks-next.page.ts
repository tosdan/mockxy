import { ChangeDetectionStrategy, Component, effect, inject, OnInit, signal, ViewContainerRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideCheck, lucideChevronDown, lucideCog, lucideFileCode, lucideFolderOpen, lucideLayers, lucideListTree, lucidePlus, lucideUpload } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiMenu, UiMenuItem } from '../../ui/ui-menu/ui-menu';
import { UiDialog } from '../../ui/ui-dialog/ui-dialog';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { MocksNextCatalog } from './catalog/mocks-next-catalog';
import { MocksNextCreateDialog, type CreateDialogData } from './create/mocks-next-create-dialog';
import { OpenapiImportDialog } from './openapi-import/openapi-import-dialog';
import { MocksNextDetail } from './detail/mocks-next-detail';
import { MocksStore } from './mocks-next.store';
import { ViewSwitcher } from '../../shared/view-switcher';
import type { MockType } from '../../mock-admin-api.types';

/**
 * Schermata Mocks: catalogo + dettaglio cablati ai dati REALI via MocksStore.
 * Topbar + status strip inline; catalogo e dettaglio sono componenti dedicati.
 */
@Component({
  selector: 'app-mocks-next',
  imports: [ViewSwitcher, CdkMenuTrigger, NgIcon, TranslocoPipe, UiButton, UiMenu, UiMenuItem, MocksNextCatalog, MocksNextDetail],
  providers: [
    MocksStore,
    provideIcons({ lucideActivity, lucideCheck, lucideChevronDown, lucideCog, lucideFileCode, lucideFolderOpen, lucideLayers, lucideListTree, lucidePlus, lucideUpload }),
  ],
  templateUrl: './mocks-next.page.html',
  styleUrl: './mocks-next.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MocksNextPage implements OnInit {
  protected readonly store = inject(MocksStore);
  private readonly dialog = inject(UiDialog);
  private readonly vcr = inject(ViewContainerRef);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  /** Larghezza del catalogo (px), ridimensionabile col divisore e persistita in localStorage. */
  protected readonly catalogWidth = signal(clampCatalogWidth(readStoredCatalogWidth()));

  constructor() {
    // Gli errori dello store diventano toast (bottom-right), piu' visibili dello status strip.
    effect(() => {
      const err = this.store.error();
      if (err) {
        this.toast.show({ title: this.transloco.translate('common.error'), description: err, tone: 'error' });
      }
    });
  }

  ngOnInit(): void {
    // "Vai al mock" dal monitor: ?m=METODO&p=ROUTE preseleziona la definizione corrispondente.
    const params = this.route.snapshot.queryParamMap;
    const method = params.get('m');
    const path = params.get('p');
    this.store.loadCatalog(method && path ? { method, path } : undefined);
  }

  /** Apre il dialog "Nuovo" per il tipo scelto (vcr → il dialog vede lo store page-scoped). */
  protected openCreate(type: MockType): void {
    this.dialog.open(MocksNextCreateDialog, {
      data: { type } satisfies CreateDialogData,
      viewContainerRef: this.vcr,
      autoFocus: 'dialog',
    });
  }

  /** Apre il mini-wizard di import OpenAPI (vcr → vede lo store page-scoped per ricaricare il catalogo). */
  protected openImport(): void {
    this.dialog.open(OpenapiImportDialog, {
      viewContainerRef: this.vcr,
      autoFocus: 'dialog',
    });
  }

  /** Avvia il drag del divisore: aggiorna la larghezza del catalogo, la persiste a fine drag. */
  protected startResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.catalogWidth();
    const onMove = (e: PointerEvent) => this.catalogWidth.set(clampCatalogWidth(startWidth + (e.clientX - startX)));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('user-select');
      try {
        localStorage.setItem(CATALOG_WIDTH_KEY, String(this.catalogWidth()));
      } catch {
        /* localStorage non disponibile: ignora */
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
  }

  /** Doppio click sul divisore → larghezza di default. */
  protected resetCatalogWidth(): void {
    this.catalogWidth.set(DEFAULT_CATALOG_WIDTH);
    try {
      localStorage.setItem(CATALOG_WIDTH_KEY, String(DEFAULT_CATALOG_WIDTH));
    } catch {
      /* ignora */
    }
  }
}

const CATALOG_WIDTH_KEY = 'mx-catalog-width';
const DEFAULT_CATALOG_WIDTH = 380;
const MIN_CATALOG_WIDTH = 380;

/** Legge la larghezza catalogo salvata (o il default). */
function readStoredCatalogWidth(): number {
  try {
    const raw = localStorage.getItem(CATALOG_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : DEFAULT_CATALOG_WIDTH;
  } catch {
    return DEFAULT_CATALOG_WIDTH;
  }
}

/** Vincola la larghezza tra un minimo e (viewport − spazio minimo per il dettaglio). */
function clampCatalogWidth(width: number): number {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const max = Math.max(MIN_CATALOG_WIDTH, viewport - 480);
  return Math.round(Math.max(MIN_CATALOG_WIDTH, Math.min(width, max)));
}
