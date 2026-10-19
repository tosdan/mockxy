import { Directive } from '@angular/core';
import { CdkMenu, CdkMenuItem, CdkMenuItemCheckbox } from '@angular/cdk/menu';

/**
 * Dropdown menu "helm" su CDK Menu (overlay, navigazione da tastiera, focus, chiusura).
 * Si apre con [cdkMenuTriggerFor] su un trigger; il pannello e' un <ng-template> con [ui-menu]
 * e bottoni [ui-menu-item]. Stile dai token.
 */
@Directive({
  selector: '[ui-menu]',
  hostDirectives: [CdkMenu],
  host: {
    class:
      'flex min-w-[12rem] flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none',
  },
})
export class UiMenu {}

@Directive({
  selector: 'button[ui-menu-item]',
  hostDirectives: [CdkMenuItem],
  host: {
    class:
      'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none transition hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50',
  },
})
export class UiMenuItem {}

/**
 * Voce di menu che si spunta (role="menuitemcheckbox", aria-checked): un'opzione che resta
 * accesa o spenta, come la densita' del catalogo. `[checked]` ne dice lo stato, `(triggered)`
 * arriva a ogni scelta. Stesso aspetto di [ui-menu-item]; la spunta visibile la mette chi la usa.
 */
@Directive({
  selector: 'button[ui-menu-item-checkbox]',
  hostDirectives: [
    { directive: CdkMenuItemCheckbox, inputs: ['cdkMenuItemChecked: checked'], outputs: ['cdkMenuItemTriggered: triggered'] },
  ],
  host: {
    class:
      'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none transition hover:bg-accent focus:bg-accent disabled:pointer-events-none disabled:opacity-50',
  },
})
export class UiMenuItemCheckbox {}
