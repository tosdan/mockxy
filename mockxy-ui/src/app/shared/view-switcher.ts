import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideCheck, lucideChevronDown, lucideDatabase, lucideFileJson, lucideListTree } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiMenu, UiMenuItem } from '../ui/ui-menu/ui-menu';

export type AppView = 'catalogo' | 'monitor' | 'storico' | 'dati';

interface ViewDef {
  readonly id: AppView;
  readonly label: string;
  readonly icon: string;
  readonly path: string;
}

const VIEWS: readonly ViewDef[] = [
  { id: 'catalogo', label: 'viewSwitcher.catalogo', icon: 'lucideListTree', path: '/mocks' },
  { id: 'monitor', label: 'viewSwitcher.monitor', icon: 'lucideActivity', path: '/monitor' },
  { id: 'storico', label: 'viewSwitcher.storico', icon: 'lucideDatabase', path: '/storico' },
  { id: 'dati', label: 'viewSwitcher.dati', icon: 'lucideFileJson', path: '/dati' },
];

/**
 * Switcher per navigare tra le view dell'app (Catalogo / Monitor / Storico / Dati): mostra la view
 * corrente e apre un dropdown per saltare alle altre. Riusato nelle topbar al posto dei link ad-hoc.
 */
@Component({
  selector: 'app-view-switcher',
  imports: [CdkMenuTrigger, NgIcon, TranslocoPipe, UiButton, UiMenu, UiMenuItem],
  providers: [provideIcons({ lucideActivity, lucideCheck, lucideChevronDown, lucideDatabase, lucideFileJson, lucideListTree })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ui-button variant="outline" size="sm" [cdkMenuTriggerFor]="menu" [attr.aria-label]="'viewSwitcher.changeView' | transloco">
      <ng-icon [name]="currentView().icon" size="0.95rem" /> {{ currentView().label | transloco }}
      <ng-icon name="lucideChevronDown" size="0.8rem" class="text-muted-foreground" />
    </button>
    <ng-template #menu>
      <div ui-menu class="min-w-[12rem]">
        @for (v of views; track v.id) {
        <button ui-menu-item (click)="go(v)">
          <ng-icon [name]="v.icon" size="0.9rem" [class.text-brand]="v.id === current()" />
          <span class="flex-1">{{ v.label | transloco }}</span>
          @if (v.id === current()) { <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" /> }
        </button>
        }
      </div>
    </ng-template>
  `,
})
export class ViewSwitcher {
  readonly current = input.required<AppView>();
  private readonly router = inject(Router);
  protected readonly views = VIEWS;
  protected readonly currentView = computed(() => VIEWS.find((view) => view.id === this.current()) ?? VIEWS[0]);

  protected go(view: ViewDef): void {
    if (view.id !== this.current()) {
      this.router.navigateByUrl(view.path);
    }
  }
}
