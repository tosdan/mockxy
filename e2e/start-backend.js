// Launcher del backend per gli e2e: prima di avviare il server ricrea la "run dir" copiando le
// fixture immutabili di workspace-test/mocks. Così ogni avvio riparte da uno stato noto e i test
// che scrivono lavorano su una copia, senza mai toccare le fixture sorgente.
//
// La copia avviene QUI (nel comando del webServer) e non in globalSetup di proposito: garantisce
// che la cartella esista prima del boot del backend, indipendentemente dall'ordine interno di
// Playwright. Le variabili d'ambiente (PORT, MOCKS_DIR, ...) le passa playwright.config.js.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "workspace-test", ".run");
const runMocks = path.join(runDir, "mocks");

fs.rmSync(runMocks, { recursive: true, force: true });
fs.cpSync(path.join(root, "workspace-test", "mocks"), runMocks, { recursive: true });
fs.mkdirSync(path.join(runDir, "dump"), { recursive: true });
// Cartella dei file dati (pagina Dati): parte vuota a ogni run — i test la popolano e la ripuliscono.
fs.rmSync(path.join(runDir, "files"), { recursive: true, force: true });
fs.mkdirSync(path.join(runDir, "files"), { recursive: true });

// index.js avvia il server come side effect del require (legge la config da process.env).
require(path.join(root, "index.js"));
