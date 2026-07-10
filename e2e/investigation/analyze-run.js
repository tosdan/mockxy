/*
 * Analizzatore di un run dell'indagine ng serve: estrae la linea temporale del guasto da una
 * cartella di log del wrapper strumentato. Uso: node analyze-run.js <run-dir>
 */
const fs = require("fs");
const path = require("path");

const dir = process.argv[2];
if (!dir) {
  console.error("uso: node analyze-run.js <run-dir>");
  process.exit(1);
}

const read = (name) => {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return "";
  }
};

console.log(`===== ${dir} =====`);

// Esito del run Playwright: ultime righe significative
const pw = read("playwright.log").split(/\r?\n/);
const pwSummary = pw.filter((line) => /(\d+ (passed|failed)|Error:|ERR_CONNECTION_REFUSED)/.test(line));
const firstRefused = pw.find((line) => line.includes("ERR_CONNECTION_REFUSED"));
const firstFail = pw.find((line) => /✘|✕|\d+\) \[chromium\]/.test(line));
console.log("\n--- Playwright ---");
console.log(`esito: ${pwSummary.filter((l) => /\d+ (passed|failed)/.test(l)).slice(-2).join(" | ") || "?"}`);
console.log(`refused totali: ${pw.filter((line) => line.includes("ERR_CONNECTION_REFUSED")).length}`);
if (firstFail) console.log(`primo fallimento: ${firstFail.trim().slice(0, 160)}`);
if (firstRefused) console.log(`primo refused:   ${firstRefused.trim().slice(0, 160)}`);
const lastOkBeforeFail = (() => {
  if (!firstFail) return null;
  const failIdx = pw.indexOf(firstFail);
  for (let i = failIdx - 1; i >= 0; i -= 1) {
    if (/ok \d+/.test(pw[i])) return pw[i].trim().slice(0, 160);
  }
  return null;
})();
if (lastOkBeforeFail) console.log(`ultimo ok prima: ${lastOkBeforeFail}`);

// Eventi del wrapper: spawn/exit/segnali
console.log("\n--- events.log ---");
console.log(read("events.log").trim() || "(vuoto)");

// Probe: tutte le transizioni (niente heartbeat)
console.log("\n--- probe: transizioni ---");
for (const line of read("probe.jsonl").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const entry = JSON.parse(line);
    if (entry.transition) console.log(`${entry.t} :${entry.port} ${entry.transition} ${JSON.stringify(entry.detail)} childAlive=${entry.childAlive}`);
  } catch {
    /* riga troncata dal kill finale */
  }
}

// Ultime parole di ng serve
const ng = read("ngserve.log").split(/\r?\n/).filter(Boolean);
console.log(`\n--- ngserve.log: ${ng.length} righe, ultime 15 ---`);
for (const line of ng.slice(-15)) console.log(line.slice(0, 220));
const errors = ng.filter((line) => /\[err\]|error|FATAL|heap|EADDR|ECONN|EPIPE|Exception/i.test(line));
if (errors.length > 0) {
  console.log(`--- ngserve.log: ${errors.length} righe sospette (err/error/heap/...) ---`);
  for (const line of errors.slice(-20)) console.log(line.slice(0, 220));
}

// Curva memoria: primo campione, massimo per processo, ultimo campione + contatori TCP
console.log("\n--- memoria/TCP ---");
const samples = read("memory.jsonl")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((sample) => sample && !sample.error);
if (samples.length === 0) {
  console.log("(nessun campione)");
} else {
  const maxRss = new Map();
  let maxTw = 0;
  for (const sample of samples) {
    maxTw = Math.max(maxTw, sample.timeWait ?? 0);
    for (const proc of sample.tree ?? []) {
      const key = `${proc.name}#${proc.pid}`;
      maxRss.set(key, Math.max(maxRss.get(key) ?? 0, proc.rssMB));
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  console.log(`campioni: ${samples.length} (${first.t} -> ${last.t})`);
  console.log(`TIME_WAIT max: ${maxTw} | ultimo: tw=${last.timeWait} listen4301=${last.listen4301} estab4301=${last.estab4301} childAlive=${last.childAlive}`);
  console.log("RSS max per processo (MB):");
  for (const [key, rss] of [...maxRss.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${rss}`);
  console.log(`albero ultimo campione: ${JSON.stringify(last.tree)}`);
}

// Autopsie
for (let i = 1; i <= 6; i += 1) {
  const pm = read(`postmortem-${i}.txt`);
  if (pm) {
    console.log(`\n--- postmortem-${i}.txt (prime 60 righe) ---`);
    console.log(pm.split(/\r?\n/).slice(0, 60).join("\n"));
  }
}
