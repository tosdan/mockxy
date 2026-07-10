import { Injectable, TemplateRef, inject } from '@angular/core';
import { Dialog, DialogConfig, DialogRef } from '@angular/cdk/dialog';
import { ComponentType } from '@angular/cdk/portal';

/**
 * Wrapper sottile su CDK Dialog: overlay + focus trap + Esc/backdrop da CDK,
 * con backdrop e centratura coerenti coi token. Il contenuto (component o
 * TemplateRef) lo stilizzi tu (es. con ui-card). Chiusura via DialogRef.close().
 */
@Injectable({ providedIn: 'root' })
export class UiDialog {
  private readonly dialog = inject(Dialog);

  open(
    content: ComponentType<unknown> | TemplateRef<unknown>,
    config?: DialogConfig<unknown, DialogRef<unknown>>,
  ): DialogRef<unknown> {
    return this.dialog.open(content, {
      backdropClass: ['ui-dialog-backdrop'],
      panelClass: ['ui-dialog-panel'],
      ...config,
    });
  }
}
