const fs = require("fs");
const path = require("path");

/**
 * L'interfaccia compilata che il motore trova accanto a sé, quando nessuno gli dice dov'è.
 *
 * Il motore sa servire l'interfaccia sotto `/_admin/ui` (config.uiDistDir), ma fuori dall'app
 * desktop nessuno impostava `UI_DIST_DIR`: per avere l'interfaccia bisognava tenere acceso
 * `ng serve` in un secondo terminale, con tutte le dipendenze di Angular installate. Qui si
 * cerca una build già pronta nei posti convenzionali e, se c'è, la si serve.
 *
 * Vale solo per chi avvia il motore da riga di comando (index.js): chi lo incorpora (l'app
 * desktop, i test) continua a decidere da sé con `uiDistDir`.
 */

// Sotto questo percorso il motore monta l'interfaccia: la build deve essere fatta per lui.
const UI_BASE_HREF = "/_admin/ui/";

// Dove può stare la build, rispetto alla radice del motore, in ordine di preferenza:
// - `ui/`: dove la mettono le distribuzioni che la portano già compilata (immagine Docker);
// - `mockxy-ui/dist/…`: dove la lascia `npm run build:ui` in un clone del repository.
const BUNDLED_UI_LOCATIONS = ["ui", path.join("mockxy-ui", "dist", "mockxy-ui", "browser")];

// Il valore di <base href> dichiarato da index.html, o null se non si legge.
function readBaseHref(uiDir) {
  try {
    const html = fs.readFileSync(path.join(uiDir, "index.html"), "utf8");
    const match = /<base\s[^>]*href\s*=\s*["']([^"']*)["']/i.exec(html);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Cerca la build sotto `engineRoot`. Restituisce:
 * - `{ dir }` per la prima build fatta per `/_admin/ui/`;
 * - `{ dir: null, unusable }` se c'è una build ma per un altro percorso base (per esempio
 *   quella di `npm run build:frontend`, pensata per essere servita alla radice);
 * - `{ dir: null }` se non c'è nulla.
 */
function findBundledUi(engineRoot) {
  let unusable;
  for (const location of BUNDLED_UI_LOCATIONS) {
    const dir = path.join(engineRoot, location);
    const baseHref = readBaseHref(dir);
    if (baseHref === UI_BASE_HREF) {
      return { dir };
    }
    if (baseHref != null && unusable == null) {
      unusable = { dir, baseHref };
    }
  }
  return unusable ? { dir: null, unusable } : { dir: null };
}

/**
 * Decide se servire l'interfaccia trovata accanto al motore. `config` è la configurazione già
 * risolta (ambiente, `.env`, CLI). Restituisce `{ uiDistDir }` da aggiungere agli override,
 * oppure `{ uiDistDir: undefined, hint }` con il motivo, da dire all'avvio.
 *
 * Non si tocca nulla quando `UI_DIST_DIR` è impostata (decide chi configura) né quando l'admin
 * API è spenta: senza API l'interfaccia non ha niente da mostrare.
 */
function resolveBundledUi({ config, engineRoot }) {
  if (config.uiDistDir != null || config.adminApiEnabled !== true) {
    return { uiDistDir: undefined };
  }
  const found = findBundledUi(engineRoot);
  if (found.dir != null) {
    return { uiDistDir: found.dir };
  }
  if (found.unusable) {
    return {
      uiDistDir: undefined,
      hint: `A compiled interface was found in ${found.unusable.dir}, but it was built for the base path "${found.unusable.baseHref}" and cannot be served under ${UI_BASE_HREF}. Rebuild it with "npm run build:ui".`,
    };
  }
  return {
    uiDistDir: undefined,
    hint: `The web interface is not built, so ${UI_BASE_HREF} is not served. Build it once with "npm run install:frontend" and "npm run build:ui", or run it in development with "npm run dev:frontend".`,
  };
}

module.exports = { BUNDLED_UI_LOCATIONS, findBundledUi, resolveBundledUi, UI_BASE_HREF };
