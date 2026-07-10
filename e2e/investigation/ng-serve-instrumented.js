/*
 * Wrapper strumentato per l'indagine sul collasso di `ng serve` a metà run e2e (vedi
 * docs/sviluppo/E2E-ARCHITETTURA-SERVER.md). Avvia ng serve TRAMITE LA STESSA CATENA npm dell'architettura A
 * (`npm --prefix mockxy-ui run start:e2e`, quindi cmd → npm → cmd → node ng → esbuild) e osserva:
 *
 *  - ngserve.log    ogni riga di stdout/stderr del dev server, con timestamp (le "ultime parole");
 *  - events.log     ciclo di vita: spawn, EXIT del figlio (codice/segnale), segnali al wrapper;
 *  - memory.jsonl   ogni 3s: RSS dell'albero di processi del figlio + contatori TCP di sistema
 *                   (TIME_WAIT totali, stato della :4301) — per OOM del processo e port exhaustion;
 *  - probe.jsonl    ogni 2s: GET indipendente su :4301 e :3101 (transizioni up/down + heartbeat);
 *  - postmortem-*.txt  al momento del guasto (exit del figlio o probe :4301 giù): netstat,
 *                   tasklist e registro eventi Windows degli ultimi minuti (crash WER, ecc.).
 *
 * Usato come comando `webServer` dalla config playwright.ngprobe.config.js. La cartella dei log è
 * PROBE_LOG_DIR (impostata dal supervisore, un run = una cartella).
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOG_DIR = process.env.PROBE_LOG_DIR || path.join(REPO_ROOT, "workspace-test", ".run", "probe-logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

// Scritture SINCRONE: Playwright termina il webServer con taskkill /T /F (kill duro, niente
// flush dei buffer) — con gli stream async le ultime righe (le più preziose) andrebbero perse.
const syncAppender = (name) => {
  const file = path.join(LOG_DIR, name);
  return (line) => {
    try {
      fs.appendFileSync(file, line);
    } catch {
      /* disco pieno o file lockato: non far cadere il wrapper */
    }
  };
};
const ngLog = { write: syncAppender("ngserve.log") };
const eventsLog = { write: syncAppender("events.log") };
const memoryLog = { write: syncAppender("memory.jsonl") };
const probeLog = { write: syncAppender("probe.jsonl") };

const ts = () => new Date().toISOString();
const ev = (msg) => eventsLog.write(`${ts()} ${msg}\n`);

ev(`WRAPPER-START pid=${process.pid} node=${process.version} logDir=${LOG_DIR}`);

// --- avvio del dev server via la catena npm originale -------------------------------------------
const CMD = "npm --prefix mockxy-ui run start:e2e";
const child = spawn(CMD, { shell: true, cwd: REPO_ROOT, windowsHide: true });
ev(`CHILD-SPAWN pid=${child.pid} cmd="${CMD}"`);

let childExited = false;
let teardownRequested = false;

for (const [stream, tag] of [[child.stdout, "out"], [child.stderr, "err"]]) {
  readline.createInterface({ input: stream }).on("line", (line) => {
    ngLog.write(`${ts()} [${tag}] ${line}\n`);
  });
}

child.on("exit", (code, signal) => {
  childExited = true;
  ev(`CHILD-EXIT code=${code} signal=${signal} teardownRequested=${teardownRequested}`);
  postmortem(`child-exit code=${code} signal=${signal}`);
});
child.on("error", (error) => ev(`CHILD-ERROR ${error.message}`));

// --- autopsia al momento del guasto --------------------------------------------------------------
let postmortemCount = 0;
function postmortem(reason) {
  if (postmortemCount >= 6) return; // anti-spam
  postmortemCount += 1;
  const file = path.join(LOG_DIR, `postmortem-${postmortemCount}.txt`);
  const sections = [`REASON: ${reason}`, `TIME: ${ts()}`];
  const run = (title, command, args) => {
    try {
      const res = spawnSync(command, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
      sections.push(`\n===== ${title} =====\n${(res.stdout || "") + (res.stderr || "")}`);
    } catch (error) {
      sections.push(`\n===== ${title} (FALLITO: ${error.message}) =====`);
    }
  };
  run("netstat :4301 (tutti gli stati)", "cmd.exe", ["/c", "netstat -ano | findstr :4301"]);
  run("netstat :3101 LISTENING", "cmd.exe", ["/c", "netstat -ano | findstr :3101 | findstr LISTENING"]);
  run("conteggio TIME_WAIT globale", "cmd.exe", ["/c", 'netstat -ano | find /c "TIME_WAIT"']);
  run("processi node/esbuild vivi", "powershell.exe", ["-NoProfile", "-Command",
    "Get-Process node,esbuild -ErrorAction SilentlyContinue | Format-Table Id,ProcessName,@{n='WS_MB';e={[math]::Round($_.WS/1MB)}} -AutoSize"]);
  run(
    "eventi Windows ultimi 5 min (Application, err/warn)",
    "powershell.exe",
    ["-NoProfile", "-Command",
      "Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddMinutes(-5)} -MaxEvents 60 -ErrorAction SilentlyContinue | Where-Object { $_.Level -le 3 } | Format-List TimeCreated,ProviderName,Id,LevelDisplayName,Message"],
  );
  run(
    "eventi Windows ultimi 5 min (System, err/warn)",
    "powershell.exe",
    ["-NoProfile", "-Command",
      "Get-WinEvent -FilterHashtable @{LogName='System';StartTime=(Get-Date).AddMinutes(-5)} -MaxEvents 60 -ErrorAction SilentlyContinue | Where-Object { $_.Level -le 3 } | Format-List TimeCreated,ProviderName,Id,LevelDisplayName,Message"],
  );
  fs.writeFileSync(file, sections.join("\n"));
  ev(`POSTMORTEM-${postmortemCount} scritto (${reason})`);
}

// --- campionamento memoria dell'albero + contatori TCP -------------------------------------------
const SAMPLER_PS = `
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='esbuild.exe' OR Name='cmd.exe' OR Name='npm.cmd'" |
  Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize
$tw = @(Get-NetTCPConnection -State TimeWait -ErrorAction SilentlyContinue).Count
$listen = @(Get-NetTCPConnection -LocalPort 4301 -State Listen -ErrorAction SilentlyContinue).Count
$estab = @(Get-NetTCPConnection -LocalPort 4301 -State Established -ErrorAction SilentlyContinue).Count
[pscustomobject]@{ procs = @($procs); timeWait = $tw; listen4301 = $listen; estab4301 = $estab } | ConvertTo-Json -Compress -Depth 4
`.trim();

let sampling = false;
const samplerTimer = setInterval(() => {
  if (sampling) return; // il campione precedente non ha ancora finito
  sampling = true;
  try {
    const res = spawnSync("powershell.exe", ["-NoProfile", "-Command", SAMPLER_PS], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    const parsed = JSON.parse(res.stdout);
    const all = Array.isArray(parsed.procs) ? parsed.procs : [parsed.procs].filter(Boolean);
    // albero del figlio: chiusura transitiva sui ParentProcessId a partire dal pid spawnato
    const inTree = new Set([child.pid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const proc of all) {
        if (!inTree.has(proc.ProcessId) && inTree.has(proc.ParentProcessId)) {
          inTree.add(proc.ProcessId);
          grew = true;
        }
      }
    }
    const tree = all
      .filter((proc) => inTree.has(proc.ProcessId))
      .map((proc) => ({ pid: proc.ProcessId, name: proc.Name, rssMB: Math.round(proc.WorkingSetSize / 1048576) }));
    memoryLog.write(`${JSON.stringify({
      t: ts(),
      childAlive: !childExited,
      tree,
      treeTotalMB: tree.reduce((sum, proc) => sum + proc.rssMB, 0),
      timeWait: parsed.timeWait,
      listen4301: parsed.listen4301,
      estab4301: parsed.estab4301,
    })}\n`);
  } catch (error) {
    memoryLog.write(`${JSON.stringify({ t: ts(), error: error.message })}\n`);
  } finally {
    sampling = false;
  }
}, 3000);

// --- probe HTTP indipendente ----------------------------------------------------------------------
const probeState = { 4301: null, 3101: null };
let lastHeartbeat = 0;
function probeOnce(port, pathName) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathName, timeout: 1500 }, (res) => {
      res.resume();
      resolve({ up: true, status: res.statusCode });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (error) => resolve({ up: false, error: error.code || error.message }));
  });
}
const probeTimer = setInterval(async () => {
  const results = {
    4301: await probeOnce(4301, "/"),
    3101: await probeOnce(3101, "/_admin/api/mocks"),
  };
  for (const port of [4301, 3101]) {
    const state = results[port].up ? "up" : "down";
    if (probeState[port] !== state) {
      probeLog.write(`${JSON.stringify({ t: ts(), port, transition: `${probeState[port]}->${state}`, detail: results[port], childAlive: !childExited })}\n`);
      if (port === 4301 && probeState[port] === "up" && state === "down") {
        postmortem(`probe :4301 up->down (childAlive=${!childExited})`);
      }
      probeState[port] = state;
    }
  }
  if (Date.now() - lastHeartbeat > 30000) {
    lastHeartbeat = Date.now();
    probeLog.write(`${JSON.stringify({ t: ts(), heartbeat: { 4301: probeState[4301], 3101: probeState[3101] }, childAlive: !childExited })}\n`);
  }
}, 2000);

// --- teardown -------------------------------------------------------------------------------------
// NB: Playwright su Windows termina il webServer con taskkill /T /F: questi handler possono non
// eseguire mai (kill duro). La discriminazione morte-spontanea vs teardown avviene via timestamp
// (CHILD-EXIT durante la suite = spontanea; a fine suite = teardown).
function shutdown(origin) {
  teardownRequested = true;
  ev(`WRAPPER-SHUTDOWN origin=${origin} childExited=${childExited}`);
  clearInterval(samplerTimer);
  clearInterval(probeTimer);
  if (!childExited && child.pid) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { timeout: 15000, windowsHide: true });
    } catch {
      /* già morto */
    }
  }
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
