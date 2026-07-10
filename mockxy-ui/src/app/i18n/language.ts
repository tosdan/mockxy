/** Lingue supportate dalla UI. La prima è anche il default/fallback. */
export type AppLang = 'it' | 'en';
export const APP_LANGS: readonly AppLang[] = ['it', 'en'];

const LANG_STORAGE_KEY = 'mx-lang';

/** Ponte desktop (Electron), se presente: la lingua è condivisa con la view di benvenuto. */
interface DesktopLangBridge {
  language?: string;
  setLanguage?: (lang: string) => Promise<unknown>;
}
function desktopBridge(): DesktopLangBridge | null {
  const bridge = (globalThis as { desktop?: DesktopLangBridge }).desktop;
  return bridge && typeof bridge === 'object' ? bridge : null;
}

function isAppLang(value: unknown): value is AppLang {
  return value === 'it' || value === 'en';
}

/** Rileva la lingua dall'ambiente browser: italiano se la locale comincia per "it", altrimenti inglese. */
function detectBrowserLang(): AppLang {
  try {
    return (navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Lingua iniziale dell'interfaccia. Nell'app desktop arriva dal processo principale (condivisa con la
 * view di benvenuto e già risolta al primo avvio dalla locale di sistema). Nel browser si usa la
 * lingua salvata e, in sua assenza, quella del browser.
 */
export function readStoredLang(): AppLang {
  const desktopLang = desktopBridge()?.language;
  if (isAppLang(desktopLang)) {
    return desktopLang;
  }
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (isAppLang(saved)) {
      return saved;
    }
  } catch {
    /* localStorage non disponibile: usa il rilevamento */
  }
  return detectBrowserLang();
}

/** Persiste la lingua scelta: nell'app desktop nelle preferenze globali (condivisa), sempre in localStorage. */
export function storeLang(lang: AppLang): void {
  const bridge = desktopBridge();
  if (bridge?.setLanguage) {
    try {
      void bridge.setLanguage(lang);
    } catch {
      /* ignora: resta comunque salvata in localStorage */
    }
  }
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignora */
  }
}
