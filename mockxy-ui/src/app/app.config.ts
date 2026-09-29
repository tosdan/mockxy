import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';

import { routes } from './app.routes';
import { TranslocoBundledLoader } from './i18n/transloco-loader';
import { readStoredLang } from './i18n/language';
import { RuntimeSyncStore } from './shared/runtime-sync.store';

registerLocaleData(localeIt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // Sincronizzazione col runtime (GET /info): parte con l'app, non con i singoli store, così nei
    // test di componenti e store il polling non parte da solo.
    provideAppInitializer(() => inject(RuntimeSyncStore).start()),
    provideTransloco({
      config: {
        availableLangs: ['it', 'en'],
        defaultLang: readStoredLang(),
        fallbackLang: 'it',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoBundledLoader,
    }),
  ]
};
