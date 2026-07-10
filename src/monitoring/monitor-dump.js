const fs = require("fs");
const path = require("path");
const { isSafeDumpFileName } = require("./monitor-dump-reader");
// Default condivisi con la config del motore (unica fonte): valgono quando il writer è costruito
// direttamente senza opzioni (test, usi programmatici); dal server arrivano già valorizzati.
const { WORKSPACE_SETTING_DEFAULTS } = require("../config");

const DEFAULT_INTERVAL_MS = WORKSPACE_SETTING_DEFAULTS.monitorDumpIntervalMs;
const DEFAULT_THRESHOLD = WORKSPACE_SETTING_DEFAULTS.monitorDumpThreshold;
const DEFAULT_MAX_FILE_BYTES = WORKSPACE_SETTING_DEFAULTS.monitorDumpMaxFileBytes;
const DEFAULT_MAX_TOTAL_BYTES = WORKSPACE_SETTING_DEFAULTS.monitorDumpMaxTotalBytes;

function noopLogger() {
  return { error() {}, warn() {}, info() {}, debug() {} };
}

// Rende una stringa (es. un timestamp ISO) sicura come nome file su qualunque filesystem.
function sanitizeForFilename(value) {
  return String(value).replace(/[:.]/g, "-");
}

/**
 * Scrive su disco lo storico del traffico catturato dal monitor, in formato NDJSON append-only.
 *
 * È un **subscriber** di RequestMonitorStore: riceve ogni evento `request` (ignora `clear`/`snapshot`)
 * e bufferizza le entry in `pending`, indipendentemente dal cap di 250 della vista live. Il flush su file
 * avviene al primo tra: soglia di entry in pending, intervallo, o `flush()` manuale. I file sono ruotati
 * per sessione (nome col timestamp di avvio) e per dimensione. Le scritture sono serializzate per evitare
 * interleaving; un errore di scrittura viene loggato senza far crashare il monitor.
 */
class MonitorDumpWriter {
  constructor({ dumpDir, intervalMs, threshold, maxFileBytes, maxTotalBytes, logger } = {}) {
    this.dumpDir = dumpDir;
    this.intervalMs = intervalMs ?? DEFAULT_INTERVAL_MS;
    this.threshold = threshold ?? DEFAULT_THRESHOLD;
    this.maxFileBytes = maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.logger = logger || noopLogger();

    this.enabled = false;
    this.pending = [];
    this.unsubscribe = null;
    this.timer = null;
    this.monitorStore = null;

    this.sessionStamp = null;
    this.fileSeq = 0;
    this.currentFileName = null;
    this.currentFile = null;
    this.bytesWritten = 0;
    this.flushedCount = 0;

    // Coda di scrittura: incatena gli append così non si sovrappongono. `_append` non rilancia mai,
    // quindi questa promise resta sempre risolta e la catena non si "avvelena".
    this.writing = Promise.resolve();
  }

  // Avvia la cattura: apre il file di sessione, si iscrive al monitor e arma il timer di flush.
  start(monitorStore) {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    this.monitorStore = monitorStore;
    this.sessionStamp = sanitizeForFilename(new Date().toISOString());
    this.fileSeq = 1;
    this._openNewFile();
    // Potatura all'avvio della sessione: i dump di sessioni vecchie vengono ridotti sotto il
    // tetto prima di iniziare ad accumularne di nuovi. In coda di scrittura, come ogni I/O.
    this.writing = this.writing.then(() => this._prune());
    this.unsubscribe = monitorStore.subscribe((event) => this._onEvent(event));
    this.timer = setInterval(() => {
      this.flush();
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  // Ferma la cattura: disiscrive, ferma il timer e fa un flush finale del pending.
  async stop() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.monitorStore = null;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      threshold: this.threshold,
      maxTotalBytes: this.maxTotalBytes,
      currentFile: this.enabled ? this.currentFileName : null,
      pendingCount: this.pending.length,
    };
  }

  // Aggiorna intervallo/soglia a caldo; se in esecuzione riarma il timer senza ruotare il file.
  setConfig({ intervalMs, threshold } = {}) {
    if (typeof intervalMs === "number" && intervalMs > 0) {
      this.intervalMs = intervalMs;
      if (this.enabled && this.timer) {
        clearInterval(this.timer);
        this.timer = setInterval(() => {
          this.flush();
        }, this.intervalMs);
        if (this.timer && typeof this.timer.unref === "function") {
          this.timer.unref();
        }
      }
    }
    if (Number.isInteger(threshold) && threshold > 0) {
      this.threshold = threshold;
    }
  }

  // Scrive su disco le entry accumulate (se presenti) e attende che la coda di scrittura si svuoti.
  // Ritorna quante entry sono state prese in carico in questa chiamata.
  async flush() {
    let taken = 0;
    if (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      taken = batch.length;
      const lines = batch.map((entry) => `${JSON.stringify(entry)}\n`).join("");
      this.writing = this.writing.then(() => this._append(lines, batch.length));
    }
    await this.writing;
    return taken;
  }

  _onEvent(event) {
    // Solo le request alimentano il dump; `clear` non tocca il log durevole, `snapshot` non arriva qui.
    if (!event || event.type !== "request" || event.item == null) {
      return;
    }
    this.pending.push(event.item);
    if (this.pending.length >= this.threshold) {
      this.flush();
    }
  }

  _fileNameFor(seq) {
    const suffix = seq > 1 ? `-${String(seq).padStart(3, "0")}` : "";
    return `dump-${this.sessionStamp}${suffix}.ndjson`;
  }

  _openNewFile() {
    this.currentFileName = this._fileNameFor(this.fileSeq);
    this.currentFile = path.join(this.dumpDir, this.currentFileName);
    this.bytesWritten = 0;
  }

  // Append serializzato: ruota il file se la soglia di dimensione verrebbe superata; non rilancia mai.
  async _append(lines, count) {
    try {
      await fs.promises.mkdir(this.dumpDir, { recursive: true });
      const bytes = Buffer.byteLength(lines, "utf8");
      let rotated = false;
      if (this.bytesWritten > 0 && this.bytesWritten + bytes > this.maxFileBytes) {
        this.fileSeq += 1;
        this._openNewFile();
        rotated = true;
      }
      await fs.promises.appendFile(this.currentFile, lines, "utf8");
      this.bytesWritten += bytes;
      this.flushedCount += count;
      if (rotated) {
        await this._prune();
      }
    } catch (error) {
      this.logger.error("Monitor dump write failed.", {
        error: error.message,
        file: this.currentFile,
      });
    }
  }

  // Potatura non aggressiva: interviene solo quando il totale dei dump supera maxTotalBytes,
  // eliminando i file più vecchi finché si rientra nel tetto. Non tocca mai il file attivo né
  // file estranei al dump (guardia sul nome). maxTotalBytes <= 0 = pruning disattivato.
  async _prune() {
    if (!(this.maxTotalBytes > 0)) {
      return;
    }
    try {
      const names = await fs.promises.readdir(this.dumpDir);
      const candidates = [];
      let totalBytes = this.bytesWritten;
      for (const name of names) {
        if (!isSafeDumpFileName(name) || name === this.currentFileName) {
          continue;
        }
        const filePath = path.join(this.dumpDir, name);
        const stats = await fs.promises.stat(filePath);
        candidates.push({ name, filePath, size: stats.size, mtimeMs: stats.mtimeMs });
        totalBytes += stats.size;
      }
      if (totalBytes <= this.maxTotalBytes) {
        return;
      }
      candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const candidate of candidates) {
        if (totalBytes <= this.maxTotalBytes) {
          break;
        }
        await fs.promises.unlink(candidate.filePath);
        totalBytes -= candidate.size;
        this.logger.info("Monitor dump file pruned.", {
          file: candidate.name,
          maxTotalBytes: this.maxTotalBytes,
        });
      }
    } catch (error) {
      // Cartella non ancora creata: normale alla prima sessione, nulla da potare.
      if (error.code !== "ENOENT") {
        this.logger.error("Monitor dump prune failed.", { error: error.message });
      }
    }
  }
}

module.exports = {
  MonitorDumpWriter,
  sanitizeForFilename,
};
