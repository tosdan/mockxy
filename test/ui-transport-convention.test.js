const fs = require("fs");
const path = require("path");

// Convenzione architetturale della UI: ogni chiamata al motore passa da MockAdminApiService, così
// la parità fra GUI e admin API resta verificabile su un solo file. È una guardia sul codice
// sorgente, non una prova che i comportamenti di GUI e API coincidano.
const UI_APP_DIR = path.join(__dirname, "..", "mockxy-ui", "src", "app");

const TRANSPORTS = [
  { name: "HttpClient", pattern: /\bHttpClient\b/ },
  { name: "provideHttpClient", pattern: /\bprovideHttpClient\b/ },
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "EventSource", pattern: /\bEventSource\b/ },
  { name: "WebSocket", pattern: /\bWebSocket\b/ },
  { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { name: "sendBeacon", pattern: /\bsendBeacon\b/ },
];

// Usi intenzionali: il service admin (HTTP e stream SSE del Monitor) e la registrazione del
// client HTTP nella configurazione dell'app. Una nuova voce va motivata qui.
const ALLOWED = {
  "mock-admin-api.service.ts": ["HttpClient", "EventSource"],
  "app.config.ts": ["provideHttpClient"],
};

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Gli helper dei test non sono codice applicativo.
      return entry.name === "testing" ? [] : listSourceFiles(entryPath);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [entryPath] : [];
  });
}

describe("convenzione sui trasporti HTTP della UI", () => {
  test("solo MockAdminApiService parla con il motore", () => {
    const violations = [];
    for (const filePath of listSourceFiles(UI_APP_DIR)) {
      const relativePath = path.relative(UI_APP_DIR, filePath).split(path.sep).join("/");
      const source = fs.readFileSync(filePath, "utf8");
      const allowed = ALLOWED[relativePath] ?? [];
      for (const transport of TRANSPORTS) {
        if (transport.pattern.test(source) && !allowed.includes(transport.name)) {
          violations.push(`${relativePath}: ${transport.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("la scansione trova davvero i file della UI e gli usi ammessi", () => {
    const files = listSourceFiles(UI_APP_DIR).map((filePath) => path.basename(filePath));
    expect(files).toEqual(expect.arrayContaining(Object.keys(ALLOWED)));
    expect(files.some((name) => name.endsWith(".spec.ts"))).toBe(false);
  });
});
