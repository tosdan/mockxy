import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import en from '../../i18n/en.json';
import it from '../../i18n/it.json';

// I dizionari sono bundlati (import statico) invece di essere scaricati via HTTP: nessuna
// dipendenza dal base-href (il build desktop gira sotto /_admin/ui/) e nessun fetch a runtime.
// Con due lingue piccole il costo sul bundle è trascurabile; si potrà passare al lazy-load via
// HTTP se le lingue cresceranno.
const DICTIONARIES: Record<string, Translation> = { it: it as Translation, en: en as Translation };

@Injectable({ providedIn: 'root' })
export class TranslocoBundledLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(DICTIONARIES[lang] ?? {});
  }
}
