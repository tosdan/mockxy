import { TranslocoTestingModule } from '@jsverse/transloco';
import en from '../../i18n/en.json';
import it from '../../i18n/it.json';

/**
 * Modulo Transloco per i test: carica i dizionari reali con default `it`, così `translate()`
 * restituisce le stringhe italiane originali e le asserzioni sui testi restano valide.
 * Aggiungerlo agli `imports` della TestBed dei componenti/store che usano Transloco.
 */
export function translocoTesting() {
  return TranslocoTestingModule.forRoot({
    langs: { it, en },
    translocoConfig: { availableLangs: ['it', 'en'], defaultLang: 'it' },
    preloadLangs: true,
  });
}
