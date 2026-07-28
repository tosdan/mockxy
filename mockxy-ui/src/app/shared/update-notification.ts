import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideExternalLink, lucideSparkles, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UpdateNotificationService } from './update-notification.service';

/** Banner non bloccante mostrato soltanto quando esiste una release stabile più recente. */
@Component({
  selector: 'app-update-notification',
  imports: [NgIcon, TranslocoPipe, UiButton],
  providers: [provideIcons({ lucideExternalLink, lucideSparkles, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.available(); as update) {
    <section
      role="status"
      aria-live="polite"
      class="relative z-30 flex shrink-0 items-center gap-3 border-b border-brand/25 bg-brand/[0.08] px-5 py-2 text-[12px]"
    >
      <ng-icon name="lucideSparkles" size="1rem" class="shrink-0 text-brand" />
      <div class="min-w-0 flex-1">
        <span class="font-semibold text-foreground">
          {{ 'updates.availableTitle' | transloco: { version: update.latestVersion } }}
        </span>
        <span class="ml-1 text-muted-foreground">
          {{ 'updates.availableDescription' | transloco: { current: update.currentVersion } }}
        </span>
      </div>
      <button ui-button size="xs" (click)="openRelease()">
        <ng-icon name="lucideExternalLink" size="0.8rem" />
        {{ 'updates.viewRelease' | transloco }}
      </button>
      <button ui-button variant="ghost" size="xs" (click)="ignore()">
        <ng-icon name="lucideX" size="0.8rem" />
        {{ 'updates.ignoreVersion' | transloco }}
      </button>
    </section>
    }
  `,
})
export class UpdateNotification implements OnInit {
  protected readonly updates = inject(UpdateNotificationService);

  ngOnInit(): void {
    void this.updates.start();
  }

  protected openRelease(): void {
    void this.updates.openCurrent();
  }

  protected ignore(): void {
    void this.updates.ignoreCurrent();
  }
}
