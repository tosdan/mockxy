import { Injectable } from '@angular/core';

/** Prefisso delle chiavi in localStorage (accanto a mx-catalog-width, che precede questo servizio). */
const KEY_PREFIX = 'mx-view:';

/**
 * Stato UI delle view (selezioni, cartelle espanse, …) persistito in localStorage, così navigando
 * tra le view — o riaprendo l'app — ognuna si ritrova come lasciata. Nell'app desktop ogni
 * workspace è servito su una porta propria: origin diversa → localStorage separato, quindi lo
 * stato è per-workspace senza chiavi dedicate. I valori sono JSON; uno stato illeggibile o uno
 * storage non disponibile degradano a "nessuno stato salvato", mai a un errore.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + key);
      return raw == null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  write(key: string, value: unknown): void {
    try {
      if (value == null) {
        localStorage.removeItem(KEY_PREFIX + key);
      } else {
        localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
      }
    } catch {
      /* storage non disponibile o pieno: lo stato resta solo in memoria */
    }
  }
}
