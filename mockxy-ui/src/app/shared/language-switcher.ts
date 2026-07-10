import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideLanguages } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiMenu, UiMenuItem } from '../ui/ui-menu/ui-menu';
import { APP_LANGS, AppLang, storeLang } from '../i18n/language';

/**
 * Selettore di lingua (IT / EN): mostra la lingua attiva e apre un dropdown per cambiarla.
 * Il cambio è a runtime (Transloco) e viene persistito in localStorage.
 */
@Component({
  selector: 'app-language-switcher',
  imports: [CdkMenuTrigger, NgIcon, TranslocoPipe, UiButton, UiMenu, UiMenuItem],
  providers: [provideIcons({ lucideCheck, lucideLanguages })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ui-button variant="outline" size="xs" [cdkMenuTriggerFor]="menu" [attr.aria-label]="'common.language' | transloco">
      <ng-icon name="lucideLanguages" size="0.95rem" /> {{ current().toUpperCase() }}
    </button>
    <ng-template #menu>
      <div ui-menu class="min-w-[8rem]">
        @for (lang of langs; track lang) {
        <button ui-menu-item (click)="select(lang)">
          <span class="flex-1">{{ labels[lang] }}</span>
          @if (lang === current()) { <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" /> }
        </button>
        }
      </div>
    </ng-template>
  `,
})
export class LanguageSwitcher {
  private readonly transloco = inject(TranslocoService);
  protected readonly langs = APP_LANGS;
  protected readonly labels: Record<AppLang, string> = { it: 'Italiano', en: 'English' };
  protected readonly current = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected select(lang: AppLang): void {
    this.transloco.setActiveLang(lang);
    storeLang(lang);
  }
}
