// Stato runtime per gli handler locali: memoria per-endpoint tra le chiamate (vedi
// docs/progetto/DESIGN-SEQUENZE.md, sezione "memoria per gli handler").
//
// Ogni endpoint (METHOD path) ha una voce { state, callCount, firstRequestAt } condivisa tra
// le sue varianti: `state` è un oggetto mutabile che lo script usa liberamente, `callCount` e
// `firstRequestAt` permettono logiche "alla N-esima chiamata" / "dopo X ms dalla prima" senza
// accrocchi d'orologio. Tutto volutamente in-memory ed effimero: si azzera al riavvio del
// motore e col reset manuale (il "Riparti dall'inizio" della sequenza azzera anche questo);
// NON si azzera alla ricarica a caldo — il reload non sa distinguere in modo affidabile quale
// endpoint è cambiato, e uno stato che sopravvive mentre si itera sullo script è più utile che
// sorprendente. Non è un database: la documentazione degli handler lo dichiara.

class HandlerStateStore {
  constructor({ now = () => Date.now() } = {}) {
    this.entries = new Map();
    this.now = now;
  }

  /**
   * Registra un'invocazione dell'handler dell'endpoint `key` ("METHOD path") e restituisce
   * { state, callCount, firstRequestAt } da esporre nel contesto dello script.
   */
  enter(key) {
    let entry = this.entries.get(key);
    if (entry == null) {
      entry = { state: {}, callCount: 0, firstRequestAt: this.now() };
      this.entries.set(key, entry);
    }
    entry.callCount += 1;
    return {
      state: entry.state,
      callCount: entry.callCount,
      firstRequestAt: entry.firstRequestAt,
    };
  }

  /** Azzera memoria e contatori dell'endpoint: la prossima chiamata riparte da zero. */
  reset(key) {
    this.entries.delete(key);
  }
}

module.exports = {
  HandlerStateStore,
};
