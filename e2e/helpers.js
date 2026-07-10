const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

// Lingua fissata per i test: senza, la UI segue il locale del browser (en-US in Playwright) e i
// testi cambierebbero tra ambienti. La fissiamo a IT (uso reale dell'utente); lo switch di lingua
// è testato a parte in E14.
const APP_LANG = "it";
const LANG_STORAGE_KEY = "mx-lang";
const adminApiTrackers = new WeakMap();

// Backend e2e (stessa fonte di playwright.config.js). Usato dai test per ripristinare lo stato via
// API (più deterministico che via UI, indipendente dallo stato del browser dopo un eventuale fail).
const { E2E_BACKEND } = require("./backend-url");

function isTrackedAdminApiRequest(request) {
  if (request.method() === "GET") {
    return false;
  }
  try {
    const url = new URL(request.url());
    return url.pathname.startsWith("/_admin/api");
  } catch {
    return request.url().includes("/_admin/api");
  }
}

function installAdminApiTracker(page) {
  if (adminApiTrackers.has(page)) {
    return adminApiTrackers.get(page);
  }

  const pending = new Set();
  page.on("request", (request) => {
    if (isTrackedAdminApiRequest(request)) {
      pending.add(request);
    }
  });
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => pending.delete(request));

  const tracker = { pending };
  adminApiTrackers.set(page, tracker);
  return tracker;
}

async function waitForAdminApiIdle(page, { idleMs = 250, timeout = 5000 } = {}) {
  if (!page || page.isClosed()) {
    return;
  }

  const tracker = installAdminApiTracker(page);
  const startedAt = Date.now();
  let idleSince;

  while (Date.now() - startedAt < timeout) {
    if (tracker.pending.size === 0) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince >= idleMs) {
        return;
      }
    } else {
      idleSince = undefined;
    }
    await page.waitForTimeout(50);
  }

  throw new Error(`Admin API did not become idle before reset (${tracker.pending.size} request(s) pending).`);
}

/** Id admin (base64 del percorso relativo) dell'endpoint con quel path, o undefined. */
async function mockIdByPath(request, path) {
  const res = await request.get(`${E2E_BACKEND}/_admin/api/mocks`);
  const body = await res.json();
  return body.items.find((item) => item.path === path)?.id;
}

/** Imposta enabled su un endpoint via API preservando la descrizione corrente (ripristino test). */
async function setEndpointEnabled(request, path, enabled) {
  const id = await mockIdByPath(request, path);
  if (!id) return;
  const detail = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${id}`)).json();
  await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}/endpoint`, {
    data: { description: detail.endpoint?.description ?? "", enabled },
  });
}

/**
 * Naviga alla schermata Mocks con lingua deterministica e attende che il catalogo si sia popolato
 * dal backend (footer conteggi presente). addInitScript scrive localStorage prima del bootstrap
 * Angular, che legge la lingua salvata all'avvio.
 */
async function gotoMocks(page, lang = APP_LANG) {
  installAdminApiTracker(page);
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* localStorage non disponibile: ignora */
      }
    },
    { key: LANG_STORAGE_KEY, value: lang },
  );
  // UI servita dal backend sotto /_admin/ui (build). Overridabile via env (E2E_UI_PATH).
  await page.goto(process.env.E2E_UI_PATH || "/_admin/ui/mocks");
  await expect(page.locator("mocks-next-catalog").getByText(/8\s+endpoint/)).toBeVisible();
}

// Impronta DETTAGLIATA delle fixture: per ogni endpoint percorso#response#stato#collezione, più le
// collezioni (id:label:parent). Cattura anche spostamenti (collectionId) e CRUD collection, così il
// reset attende esattamente lo stato delle fixture — non un conteggio aggregato che può collidere
// con uno stato intermedio della copia.
const EXPECTED_ENDPOINTS = [
  "/api/admin/config#1#on#collection-admin",
  "/api/echo#1#on#collection-dynamic",
  "/api/enrich#1#on#collection-dynamic",
  "/api/health#1#on#-",
  "/api/legacy#1#off#-",
  "/api/status#2#on#-",
  "/api/users#1#on#collection-core",
  "/api/users/:id#1#on#collection-core",
]
  .slice()
  .sort()
  .join("\n");
const EXPECTED_COLLECTIONS = [
  "collection-admin:Admin:collection-core",
  "collection-core:Core API:-",
  "collection-dynamic:Dynamic:-",
]
  .slice()
  .sort()
  .join("\n");
const EXPECTED_FINGERPRINT = `${EXPECTED_ENDPOINTS}||${EXPECTED_COLLECTIONS}`;

function fingerprintOf(body) {
  const endpoints = body.items
    .map((i) => `${i.path}#${i.responseCount ?? 0}#${i.disabled ? "off" : "on"}#${i.collectionId ?? "-"}`)
    .sort()
    .join("\n");
  const collections = (body.collections ?? [])
    .map((c) => `${c.id}:${c.label}:${c.parentId ?? "-"}`)
    .sort()
    .join("\n");
  return `${endpoints}||${collections}`;
}

function removeEntriesMissingFromSource(sourceDir, targetDir) {
  if (!fs.existsSync(targetDir)) {
    return;
  }
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      removeEntriesMissingFromSource(sourcePath, targetPath);
    }
  }
}

/** Ricopia le fixture immutabili nella run dir senza rimuovere la root osservata dal watcher. */
function copyFixturesToRunDir() {
  const root = path.resolve(__dirname, "..");
  const run = path.join(root, "workspace-test", ".run", "mocks");
  const fixtures = path.join(root, "workspace-test", "mocks");
  fs.mkdirSync(run, { recursive: true });
  fs.cpSync(fixtures, run, { recursive: true, force: true });
  removeEntriesMissingFromSource(fixtures, run);
}

async function forceRuntimeReload(request) {
  await setEndpointEnabled(request, "/api/health", true);
}

/**
 * Ripristino completo per i test che creano/eliminano: riscrive le fixture nella run dir e attende
 * che il backend rifletta ESATTAMENTE lo stato delle fixture (impronta dettagliata). Robusto contro
 * qualsiasi mutazione e contro gli stati intermedi del reload, indipendente dal browser.
 */
async function resetWorkspace(request, page) {
  await waitForAdminApiIdle(page);
  copyFixturesToRunDir();
  await forceRuntimeReload(request);
  // Il watcher del backend ricarica in modo asincrono e ritardato: non basta vedere lo stato giusto
  // una volta, deve RESTARE quello per più letture consecutive (il watcher si è calmato). Così gli
  // eventi filesystem della copia non scattano più durante il test successivo.
  let stableReads = 0;
  await expect
    .poll(
      async () => {
        const body = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks`)).json();
        stableReads = fingerprintOf(body) === EXPECTED_FINGERPRINT ? stableReads + 1 : 0;
        return stableReads;
      },
      { timeout: 20000, intervals: [150, 200, 300, 300, 300, 300] },
    )
    .toBeGreaterThanOrEqual(3);
}

/**
 * Reload "stabile": attende che le scritture del browser verso l'admin API (POST/PUT/DELETE) siano
 * completate prima di ricaricare. Senza, un reload subito dopo una mutazione ottimistica rilegge lo
 * stato VECCHIO dal disco (la scrittura è ancora in volo) → flaky sui test "persiste dopo reload".
 */
async function reloadStable(page) {
  await waitForAdminApiIdle(page);
  await page.reload();
}

/** Apre la vista Monitor (/_admin/ui/monitor) con lingua fissata. */
async function gotoMonitor(page, lang = APP_LANG) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
    },
    { key: LANG_STORAGE_KEY, value: lang },
  );
  await page.goto("/_admin/ui/monitor");
  // L'host <app-monitor-next> ha dimensioni 0 (i figli sono visibili, l'host no): come sync point
  // uso il filtro, sempre presente nella topbar del monitor.
  await expect(page.getByPlaceholder(/Filtra path o URL/)).toBeVisible();
}

/** Svuota lo storico del monitor (in RAM lato backend). Per l'isolamento dei test del monitor. */
async function clearMonitor(request) {
  await request.delete(`${E2E_BACKEND}/_admin/api/monitoring/requests`);
}

/** Apre la vista Storico dump (/_admin/ui/storico) con lingua fissata. */
async function gotoStorico(page, lang = APP_LANG) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
    },
    { key: LANG_STORAGE_KEY, value: lang },
  );
  await page.goto("/_admin/ui/storico");
  // Sync point: il sottotitolo della topbar, univoco e sempre presente (l'host può avere dim. 0).
  await expect(page.getByText("non live · sola lettura")).toBeVisible();
}

/** Attiva/disattiva il dump su disco del monitor (cattura durevole del traffico per lo storico). */
async function setDumpEnabled(request, enabled) {
  await request.patch(`${E2E_BACKEND}/_admin/api/monitoring/dump`, { data: { enabled } });
}

/** Forza la scrittura su disco delle request in coda nel dump. Ritorna quante ne ha scritte. */
async function flushDump(request) {
  const res = await request.post(`${E2E_BACKEND}/_admin/api/monitoring/dump/flush`);
  return (await res.json()).flushed ?? 0;
}

/**
 * Isolamento dei test dello storico: ferma il dump (flush finale del pending) ed elimina tutti i file
 * di dump dalla run dir. Va chiamato prima e dopo ogni test così ogni run parte da disco pulito.
 */
async function clearDumps(request) {
  await setDumpEnabled(request, false);
  const body = await (await request.get(`${E2E_BACKEND}/_admin/api/monitoring/dumps`)).json();
  for (const file of body.files ?? []) {
    await request.delete(`${E2E_BACKEND}/_admin/api/monitoring/dumps/${encodeURIComponent(file.name)}`);
  }
}

/** Apre la vista Dati (/_admin/ui/dati) con lingua fissata. */
async function gotoDati(page, lang = APP_LANG) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
    },
    { key: LANG_STORAGE_KEY, value: lang },
  );
  await page.goto("/_admin/ui/dati");
  // Sync point: il sottotitolo della topbar, univoco e sempre presente (l'host può avere dim. 0).
  await expect(page.getByText("file json riusabili negli handler")).toBeVisible();
}

/** Isolamento dei test della pagina Dati: elimina tutti i file dati dalla run dir via API. */
async function clearDataFiles(request) {
  const body = await (await request.get(`${E2E_BACKEND}/_admin/api/files`)).json();
  for (const file of body.items ?? []) {
    await request.delete(`${E2E_BACKEND}/_admin/api/files/${encodeURIComponent(file.name)}`);
  }
}

module.exports = {
  gotoMocks,
  mockIdByPath,
  setEndpointEnabled,
  resetWorkspace,
  reloadStable,
  waitForAdminApiIdle,
  gotoMonitor,
  clearMonitor,
  gotoStorico,
  setDumpEnabled,
  flushDump,
  clearDumps,
  gotoDati,
  clearDataFiles,
  APP_LANG,
  LANG_STORAGE_KEY,
  E2E_BACKEND,
};
