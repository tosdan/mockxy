import { computed, signal } from '@angular/core';
import type { ActivationItem, ActivationPatchItem } from '../mock-admin-api.types';
import { ActivationStore, activationKey, type ActivationEndpointRef } from '../shared/activation.store';

/**
 * ActivationStore finto per i test dei componenti che mostrano le attivazioni temporanee: nessuna
 * chiamata all'API, lo stato si imposta a mano e le azioni chieste restano registrate.
 */
export function fakeActivation(initial: readonly ActivationItem[] = []) {
  const items = signal<readonly ActivationItem[]>(initial);
  const calls: { set: ActivationPatchItem[]; remove: string[]; clear: number } = { set: [], remove: [], clear: 0 };
  const store = {
    items: items.asReadonly(),
    count: computed(() => items().length),
    of: (endpoint: ActivationEndpointRef) => items().find((item) => activationKey(item) === activationKey(endpoint)),
    busy: signal(false).asReadonly(),
    load: () => {},
    set: (item: ActivationPatchItem) => calls.set.push(item),
    remove: (id: string) => calls.remove.push(id),
    clear: () => {
      calls.clear += 1;
    },
  };
  return { provider: { provide: ActivationStore, useValue: store }, items, calls };
}
