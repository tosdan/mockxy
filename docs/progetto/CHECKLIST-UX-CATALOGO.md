# Checklist implementazione — Razionalizzazione UX del Catalogo (opzione B)

Branch app: `feature/ux-catalogo-opzione-b`

Mockup di riferimento: canvas «Catalogo Mockxy — due direzioni UX», artboard **Opzione B (rev. 2)**
— <https://claude.ai/code/artifact/fe2dfcd5-725b-4fcd-b8b0-3785b776575f>

La checklist si aggiorna nello stesso branch dell'implementazione. Un punto si considera
completato soltanto quando codice e test pertinenti sono entrambi verdi.

Si procede **un gruppo alla volta**: a fine gruppo si mostra un'anteprima dell'app in esecuzione e
si aspetta l'ok prima di aprire il successivo. I gruppi sono ordinati per dipendenza — la shell
prima, perché è la cornice in cui sta tutto il resto. I commit sono granulari dentro ciascun
gruppo, così tornare indietro costa poco.

### Come si guardano le anteprime

- **Nel browser**, `npm run dev:backend` + `npm run dev:frontend`: ricarica a caldo, è la via
  veloce e basta per quasi tutti i gruppi.
- **In Electron**, `npm run dev:electron`: ricompila il frontend desktop e apre la finestra. Serve
  per i gruppi **1 e 2**, dove contano la titlebar nascosta, l'area di trascinamento e le tab dei
  workspace — tutta roba che fuori da Electron non viene renderizzata (`DesktopService.isDesktop`).

## Principio guida

Ogni funzione va al livello della cosa su cui agisce. Corollari usati per decidere:

- Ciò che si **guarda** di continuo merita spazio permanente; ciò che si **tocca** raramente sta
  dietro un click (popover o menu «…»).
- Le modifiche frequenti (status, delay, variante attiva) devono costare meno di quelle rare
  (elimina, ricarica, espandi tutto).
- Uno stato che cambia il significato di ciò che si sta leggendo va mostrato accanto a ciò che si
  legge, non in un pannello a parte.

## 0. Preparazione

- [x] Mockup rivisto e approvato (opzione B rev. 2).
- [x] Fattibilità verificata contro il codice corrente (vedi «Vincoli accertati»).
- [x] Feature branch dedicato creato.
- [x] Checklist committata nel feature branch.

## Vincoli accertati (da non ri-verificare)

- **Le PUT sulle varianti sono un merge, non un replace.** `buildUpdatedEndpointResponse`
  ([src/admin/endpoint-operations.js:427](../../src/admin/endpoint-operations.js)) conserva
  `title`, `headers`, `delayMs`, `body` e `templated` quando la chiave non è nel payload. Quindi
  status/delay/template si possono modificare in posto con una PUT parziale, senza toccare il
  backend. Nota: il tipo client `ResponseMockUpdateRequest` richiede `status`, che va rispedito
  anche quando si cambia solo il delay.
- **Il percorso relativo al workspace è già nell'id.** L'id admin di una definizione è il percorso
  relativo posix del suo file, in base64url
  ([src/admin/mock-ids.js:15](../../src/admin/mock-ids.js)). La UI può decodificarlo e mostrare
  `api/products/GET.endpoint.json` senza nuovi campi API e senza dipendere da Electron — quindi
  funziona anche nella UI servita dal motore.
- **`templated` non esiste sulle varianti file-backed**: il backend lo cancella quando la response
  resta agganciata a un file ([endpoint-operations.js:452](../../src/admin/endpoint-operations.js)).
  Il controllo «Template» va nascosto in quel caso, non mostrato disattivato.
- **La API bulk per N endpoint arbitrari non c'è, ma il meccanismo sì.**
  `updateAdminCollectionEnabled` ([src/admin/collection-operations.js:498](../../src/admin/collection-operations.js))
  fa già la scrittura multi-file atomica: raccoglie i percorsi, ne prende i backup e scrive tutto
  dentro `commitWithRollback` con un solo `reloadRuntime`. Una variante «per lista di id» cambia
  solo il criterio di selezione degli item. Si aggiunge quindi la API (gruppo 6) invece di
  ripiegare su N chiamate dal client: N chiamate possono riuscire a metà e fanno N reload, la
  rotta bulk è tutto-o-niente con un reload solo.

## 1. Rail delle view

Sostituisce lo `ViewSwitcher` a tendina; sposta impostazioni e lingua fuori dalla barra runtime.
Tocca anche Monitor / Storico / Dati, ma solo per togliere il pulsante dalle loro topbar.

- [ ] Componente `app-view-rail`: 4 voci con icona + etichetta, voce attiva evidenziata.
- [ ] Badge di stato sulle voci (pallino «live» su Monitor).
- [ ] Impostazioni e selettore lingua in fondo al rail.
- [ ] Rimuovere `app-view-switcher` dalle topbar delle quattro pagine.
- [ ] Rimuovere il selettore lingua dalla barra runtime.
- [ ] Navigazione da tastiera e `aria-current` sulla voce attiva.
- [ ] Test: rail rende le 4 voci, evidenzia la corrente, naviga al click.
- [ ] **Anteprima e ok.**

## 2. Barra unica in cima

Il runtime diventa indicatori; gli interruttori passano in un popover. La topbar di pagina del
catalogo sparisce: «Importa OpenAPI» e «Nuovo» scendono nella testata del catalogo (gruppo 4).

- [ ] Cluster di indicatori: server + indirizzo, proxy, monitor, dump — sola lettura.
- [ ] Popover runtime con gli interruttori attuali, indirizzo, copia, flush.
- [ ] Fondere la barra runtime con la barra workspace in una sola riga.
- [ ] Spostare «Apri…» e «Recenti» nella striscia delle tab workspace.
- [ ] Eliminare la topbar di pagina del catalogo (blocco logo «Mockxy / CATALOGO» incluso).
- [ ] Verificare l'area di trascinamento finestra e lo spazio dei pulsanti di sistema (Electron).
- [ ] Test: gli indicatori riflettono lo store; il popover commuta gli stessi segnali di prima.
- [ ] **Anteprima e ok.**

## 3. Status bar globale

- [ ] Striscia in fondo alla shell: conteggi endpoint / collection / attivi.
- [ ] Errori di caricamento con dettaglio apribile (oggi solo un tooltip nel footer del catalogo).
- [ ] Suggerimento della palette comandi a destra.
- [ ] Rimuovere il footer del catalogo, ora ridondante.
- [ ] Test: conteggi ed errori seguono lo store.
- [ ] **Anteprima e ok.**

## 4. Testata del catalogo

- [ ] Un solo «Nuovo ▾»: mock, handler, middleware, collection, importa OpenAPI.
- [ ] Menu «…» per ricarica, espandi tutto, collassa tutto.
- [ ] Campo di ricerca a tutta larghezza con scorciatoia `/`.
- [ ] Test: ogni voce del menu apre il flusso che aprivano i vecchi pulsanti.
- [ ] **Anteprima e ok.**

## 5. Filtri sempre visibili

- [ ] Segmentato Tutti / Attivi / Disattivi legato a `statusFilter`.
- [ ] Selettore «Tipo: …» che mostra il valore corrente invece di un pallino.
- [ ] Rendere esplicito che con un filtro attivo il riordino è sospeso (oggi sparisce in silenzio).
- [ ] Linee guida verticali dell'albero.
- [ ] Test: i filtri restano leggibili dallo stato; il reset li riporta a «tutti».
- [ ] **Anteprima e ok.**

## 6. Selezione multipla e azioni di massa

Backend prima, UI poi: la rotta bulk esiste già di fatto per le collection, va solo generalizzata
al «per lista di id».

### 6a. API bulk (backend)

- [ ] Estrarre da `updateAdminCollectionEnabled` la parte comune: da un elenco di item a scrittura
      atomica con backup, rollback e un solo reload.
- [ ] `PATCH /mocks/enabled` con `{ ids, enabled }`, che risponde come la rotta per collection
      (`items` + `collections` + `childOrder`).
- [ ] Validare gli id: lista non vuota, id noti, nessun percorso fuori da `mocksDir`.
- [ ] Riusare la rotta per collection sopra la stessa funzione, senza cambiarne il contratto.
- [ ] Aggiornare `docs/admin-api.openapi.yaml`.
- [ ] Test backend: successo, id sconosciuto, rollback su reload rifiutato, nessuna modifica
      quando gli endpoint sono già nello stato richiesto.

### 6b. Selezione e barra contestuale (UI)

- [ ] Metodo `setEndpointsEnabled(ids, enabled)` sul client admin e sullo store.
- [ ] Checkbox sulle righe endpoint, con shift-click per intervalli.
- [ ] Barra contestuale in fondo al pannello: abilita, disabilita, sposta in…, elimina.
- [ ] Conferma esplicita per l'eliminazione multipla.
- [ ] Interazione con i filtri: la selezione riguarda solo le righe visibili.
- [ ] Test: selezione, azione, annullamento, selezione che sopravvive (o no) al cambio filtro.
- [ ] **Anteprima e ok.**

## 7. Testata del dettaglio

- [ ] Breadcrumb della collection, con tendina per spostare l'endpoint.
- [ ] Azioni in chiaro: Attivo, Copia, Sequenza; menu «…» con sposta, apri cartella, copia
      percorso, elimina.
- [ ] Percorso file relativo al workspace, decodificato dall'id, a tutta larghezza.
- [ ] Ellissi centrale e valore intero nel tooltip quando il percorso non entra.
- [ ] Test: il percorso relativo si deriva dall'id; «elimina» conferma come prima.
- [ ] **Anteprima e ok.**

## 8. Barra delle varianti

- [ ] Tendina elastica (`flex` con tetto) al posto della larghezza fissa da 512 px.
- [ ] «+» e menu «…» al posto dei tre pulsanti icona.
- [ ] Status modificabile in posto (PUT parziale).
- [ ] Delay modificabile in posto (PUT parziale, rispedendo lo status corrente).
- [ ] Status e delay accanto alla tendina, non spinti al lato opposto della riga.
- [ ] Test: modifica dello status non perde body, headers, delay né il flag template.
- [ ] **Anteprima e ok.**

## 9. Stato «Template» nella testata del body

- [ ] Indicatore di stato accanto al nome del file della variante.
- [ ] Commutabile in posto, con la spiegazione dei segnaposto nel tooltip.
- [ ] Nascosto per le varianti file-backed e per i tipi che non lo supportano.
- [ ] Test: il flag persiste, e sparisce dove il backend non lo conserva.
- [ ] **Anteprima e ok.**

## 10. Palette comandi

- [ ] Apertura con `Ctrl+K` / `Cmd+K` da qualunque view.
- [ ] Salto a un endpoint per metodo e percorso.
- [ ] Comandi di runtime (server, proxy, monitor, dump) e di navigazione fra le view.
- [ ] Test: apertura, ricerca, esecuzione, chiusura con Esc.
- [ ] **Anteprima e ok.**

## Chiusura

- [ ] Traduzioni `it` ed `en` allineate per tutte le nuove stringhe.
- [ ] Passata di accessibilità (focus, contrasto, ARIA) sui nuovi controlli.
- [ ] E2E aggiornati dove toccano le topbar rimosse.
- [ ] Screenshot del README rifatto.
- [ ] Questo file cancellato: serve a tracciare il lavoro nel branch, non a finire in main.
- [ ] Squash merge della PR.
