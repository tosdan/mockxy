# La lingua dell'interfaccia

L'interfaccia è disponibile in **italiano e inglese**; si cambia dal selettore nella barra
superiore, con effetto immediato e senza riavvii.

Dove vive la scelta dipende da come si usa Mockxy:

- **nel browser** (server headless o sviluppo): al primo accesso la lingua segue il locale del
  browser; la scelta esplicita viene poi ricordata dal browser stesso, per ciascuna macchina;
- **nell'app desktop**: la scelta è salvata nelle preferenze globali accanto all'eseguibile,
  vale per tutti i workspace ed è condivisa tra l'applicazione e la schermata di benvenuto.
  Copre anche i **dialoghi nativi** (conferme di chiusura, inizializzazione workspace), che
  cambiano lingua a runtime insieme al resto.

La lingua riguarda solo l'interfaccia: i messaggi di log del motore restano in inglese,
indipendentemente dalla scelta.
