import { ChangeDetectionStrategy, Component, ViewContainerRef, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { UiDialog } from '../ui/ui-dialog/ui-dialog';
import { CommandPaletteDialog } from './command-palette-dialog';

/**
 * Scorciatoia globale della palette dei comandi (Ctrl+K / Cmd+K). Non rende nulla: sta nella shell
 * solo per ascoltare il tasto e aprire il dialog, così la palette risponde da qualunque view.
 *
 * Ctrl+K è già preso dai browser per la barra degli indirizzi: `preventDefault` è il motivo per cui
 * la si intercetta qui e non si lascia passare.
 */
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
  template: '',
})
export class CommandPalette {
  private readonly dialog = inject(UiDialog);
  private readonly vcr = inject(ViewContainerRef);
  private openRef: DialogRef<unknown> | null = null;

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key?.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    event.preventDefault();
    // Ripremere la scorciatoia con la palette aperta la chiude, invece di impilarne un'altra.
    if (this.openRef) {
      this.openRef.close();
      return;
    }
    this.openRef = this.dialog.open(CommandPaletteDialog, {
      viewContainerRef: this.vcr,
      autoFocus: 'first-tabbable',
    });
    this.openRef.closed.subscribe(() => (this.openRef = null));
  }
}
