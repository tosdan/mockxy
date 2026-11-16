/**
 * Attivazioni temporanee: per un endpoint, «acceso o spento» e «quale variante serve» decisi
 * per la sessione in corso, senza toccare i file.
 *
 * Nei file del workspace `enabled` e `selectedResponseFile` sono la decisione del team, quella
 * che va in git e che lo staging serve. Ma chi prepara lo scenario di un test, o accende un mock
 * per riprodurre un bug, non sta prendendo quella decisione: prima l'unico modo era riscrivere
 * gli stessi file, con il rischio di committarli così. Qui quello stato vive nella memoria del
 * motore: vince su quello salvato finché c'è, e sparisce al riavvio.
 *
 * Lo store non legge né scrive file. Il caricamento degli endpoint (endpoint-loader.js) gli
 * chiede, per ogni definizione, lo stato da servire, e gli dice quali file ha trovato ma non è
 * riuscito a leggere: un endpoint in quello stato non è stato eliminato.
 */

const endpointKey = (method, routePath) => `${String(method).toUpperCase()} ${routePath}`;

class ActivationOverrideStore {
  constructor() {
    // "METHOD /path" -> { method, path, enabled?, responseFile? }: presente solo il campo deciso.
    this.overrides = new Map();
    // "METHOD /path" -> file endpoint in cui l'endpoint è stato letto l'ultima volta. Serve a
    // prune() per distinguere un endpoint eliminato da uno il cui file, per ora, non si legge.
    this.files = new Map();
    // Cresce a ogni cambiamento: chi osserva (GET /info) capisce che lo scenario è cambiato.
    this.revision = 1;
  }

  get size() {
    return this.overrides.size;
  }

  // Copia ordinata per percorso e metodo, senza riferimenti interni.
  list() {
    return [...this.overrides.values()]
      .map((override) => ({ ...override }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  }

  get(method, routePath) {
    const override = this.overrides.get(endpointKey(method, routePath));
    return override ? { ...override } : null;
  }

  // Fotografia per un ripristino: le mutazioni che non riescono a installare lo scenario
  // rimettono quello di prima.
  snapshot() {
    return this.list();
  }

  // Rimette lo scenario fotografato da snapshot(), se nel frattempo è cambiato: una mutazione
  // rifiutata deve lasciare com'erano i file e anche questo. Restituisce true se ha cambiato.
  restore(snapshot) {
    if (JSON.stringify(this.list()) === JSON.stringify(snapshot)) {
      return false;
    }
    this.replaceAll(snapshot);
    return true;
  }

  // Sostituisce l'intero scenario: ciò che non è nominato torna a come è salvato.
  replaceAll(entries) {
    this.overrides = new Map();
    for (const entry of entries) {
      this._put(entry);
    }
    this.revision += 1;
  }

  // Aggiunge o aggiorna singoli endpoint; un campo `null` toglie quel campo dall'attivazione.
  apply(entries) {
    for (const entry of entries) {
      const current = this.overrides.get(endpointKey(entry.method, entry.path)) || {};
      this._put({ ...current, ...entry });
    }
    this.revision += 1;
  }

  // Toglie l'attivazione di un endpoint, o solo i campi indicati. Restituisce true se è cambiato
  // qualcosa: un salvataggio esplicito su un endpoint senza attivazioni non deve muovere nulla.
  remove(method, routePath, fields = ["enabled", "responseFile"]) {
    const key = endpointKey(method, routePath);
    const current = this.overrides.get(key);
    if (current == null || !fields.some((field) => current[field] !== undefined)) {
      return false;
    }
    const next = { ...current };
    for (const field of fields) {
      delete next[field];
    }
    this._put(next);
    this.revision += 1;
    return true;
  }

  clear() {
    if (this.overrides.size === 0) {
      return false;
    }
    this.overrides = new Map();
    this.revision += 1;
    return true;
  }

  _put({ method, path: routePath, enabled, responseFile }) {
    const key = endpointKey(method, routePath);
    const override = { method: String(method).toUpperCase(), path: routePath };
    if (typeof enabled === "boolean") {
      override.enabled = enabled;
    }
    if (typeof responseFile === "string") {
      override.responseFile = responseFile;
    }
    if (override.enabled === undefined && override.responseFile === undefined) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, override);
    }
  }

  /**
   * Lo stato da servire per una definizione appena letta dal disco. Restituisce l'endpoint con
   * `enabled` e `selectedResponseFile` effettivi. Una variante che non esiste più (cancellata a
   * mano, o dopo un pull) fa decadere quel campo: si torna a ciò che è salvato, e `dropped`
   * riceve il motivo. Il caricamento non si blocca mai per un'attivazione rimasta indietro.
   * `filePath` è il file endpoint della definizione, ricordato per prune().
   */
  applyTo(endpoint, dropped = [], filePath = null) {
    const key = endpointKey(endpoint.method, endpoint.path);
    const override = this.overrides.get(key);
    if (override == null) {
      return endpoint;
    }
    if (filePath != null) {
      this.files.set(key, filePath);
    }
    let responseFile = override.responseFile;
    if (responseFile !== undefined && !endpoint.responseFiles.includes(responseFile)) {
      dropped.push({ method: override.method, path: override.path, reason: "variant_missing", responseFile });
      this.remove(endpoint.method, endpoint.path, ["responseFile"]);
      responseFile = undefined;
    }
    return {
      ...endpoint,
      enabled: override.enabled ?? endpoint.enabled,
      selectedResponseFile: responseFile ?? endpoint.selectedResponseFile,
    };
  }

  /**
   * Dopo un caricamento completo: le attivazioni di endpoint che non esistono più decadono.
   * `unreadableFiles` sono i file endpoint presenti ma non letti in questo giro (JSON a metà di
   * una modifica a mano, un campo non valido): il runtime continua a servire la loro versione
   * di prima, e l'attivazione resta finché il file non torna leggibile o sparisce davvero.
   */
  prune(seenEndpointKeys, dropped = [], unreadableFiles = new Set()) {
    for (const [key, override] of this.overrides) {
      if (seenEndpointKeys.has(key) || unreadableFiles.has(this.files.get(key))) {
        continue;
      }
      this.overrides.delete(key);
      this.revision += 1;
      dropped.push({ method: override.method, path: override.path, reason: "endpoint_missing" });
    }
    for (const key of [...this.files.keys()]) {
      if (!this.overrides.has(key)) {
        this.files.delete(key);
      }
    }
  }
}

module.exports = { ActivationOverrideStore, endpointKey };
