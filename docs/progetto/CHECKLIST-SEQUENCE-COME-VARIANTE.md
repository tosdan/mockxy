# Checklist implementazione — Sequence come variante di response

Branch app: `feature/sequence-response-variant`

Branch acceptance test: `test/sequence-response-variant`

Piano di riferimento: `docs/progetto/ANALISI-SEQUENCE-COME-VARIANTE.md`

La checklist viene aggiornata nello stesso branch dell'implementazione. Un punto si considera
completato soltanto quando codice e test pertinenti sono entrambi verdi.

## 0. Preparazione

- [x] Analisi verificata contro il codice corrente.
- [x] Decisioni e criteri di accettazione consolidati nel piano.
- [x] Feature branch dedicato creato.
- [x] Piano e checklist committati nel feature branch.

## 1. Modello e runtime

- [x] Trasformare il normalizzatore in configurazione di response sequence, senza `enabled`.
- [x] Includere il filename della sequence nella firma runtime.
- [x] Rifiutare esplicitamente `endpoint.sequence`.
- [x] Caricare `type: "sequence"` dalla response selezionata.
- [x] Risolvere e validare integralmente gli step `mock`/`handler`.
- [x] Rifiutare step `sequence`, `middleware`, `sse` e `ws`.
- [x] Registrare e servire la route sequence attraverso la pipeline esistente.
- [x] Riconciliare cursore e handler state alle transizioni di scenario.
- [x] Conservare lo stato sui reload semanticamente invarianti e sul graft della route precedente.
- [x] Rendere il reload accodato attendibile dai chiamanti e restituirne l'esito.
- [x] Aggiornare i test unitari di config, state, loader, serving e watch.

## 2. Admin API e persistenza

- [x] Leggere, normalizzare e riepilogare response `sequence`.
- [x] Esporre `sequence`, `sequenceState` e la nuova semantica di `sequenceActive`.
- [x] Creare una response sequence e selezionarla.
- [x] Modificare una response sequence per filename.
- [x] Validare tutto il grafo prima del successo di create/update/select/copy.
- [x] Collegare l'ack strict del reload al rollback delle mutazioni admin.
- [x] Rimuovere e rifiutare il vecchio ramo `PUT { sequence }`.
- [x] Aggiornare selezione e reset sulla sequence selezionata.
- [x] Aggiungere `GET /mocks/:id/sequence/state`.
- [x] Costruire l'indice locale delle dipendenze tra response.
- [x] Rifiutare con `409` la cancellazione di target referenziati.
- [x] Supportare clone di response sequence.
- [x] Copiare la chiusura minima con `copyResponses: false`.
- [x] Aggiornare i test admin, CRUD, rollback, copia e cancellazione.

## 3. Contratto pubblico

- [x] Aggiornare `docs/admin-api.openapi.yaml`.
- [x] Aggiungere gli schemi request/response della variante sequence.
- [x] Rimuovere sequence da endpoint e dal vecchio update.
- [x] Documentare state/reset e cancellazione `409`.
- [x] Eseguire i test di validità del contratto OpenAPI.

## 4. UI

- [x] Aggiungere `sequence` a `MockType`.
- [x] Separare i tipi creabili come endpoint/form generico dal tipo generale.
- [x] Aggiungere tipi request/detail/state della sequence.
- [x] Aggiornare service e store per create/update/select/reset/state.
- [x] Convertire il dialog in modalità create/edit senza toggle `enabled`.
- [x] Rappresentare `times`/`forMs` per singolo step senza perdita.
- [x] Filtrare gli step con allow-list `mock|handler`.
- [x] Aggiungere titolo, validazione, snapshot, reset e polling cancellabile.
- [x] Mostrare il riepilogo sequence nel dettaglio senza usare il form generico.
- [x] Aggiungere Sequence al menu response e al pulsante scorciatoia.
- [x] Aggiornare catalogo, filtro, badge, token colore e icone.
- [x] Aggiornare i18n italiana e inglese.
- [x] Aggiornare test service/store/component e controlli accessibilità.
- [x] Verificare build frontend.

## 5. Migrazione e documentazione

- [x] Deciso: nessun migratore una tantum; il formato legacy viene rifiutato esplicitamente.
- [x] Non applicabile: dry-run, backup, idempotenza e test del migratore non incluso.
- [x] Aggiornare `DESIGN-SEQUENZE.md` al nuovo modello.
- [x] Aggiornare documentazione endpoint/response/catalogo/admin API in italiano e inglese.
- [x] Aggiornare README e fixture interessate.
- [x] Verificare che nessuna documentazione pubblica descriva ancora `endpoint.sequence` come formato supportato.

## 6. Verifica app

- [x] Suite backend completa verde (49 suite, 578 test).
- [x] Suite frontend completa verde (23 file, 266 test).
- [x] Build frontend desktop verde.
- [x] E2E interni pertinenti aggiornati e verdi (3 scenari Chromium).
- [x] `git diff --check` pulito.
- [x] Riesame finale dei criteri di accettazione del piano.

## 7. Acceptance test esterni

- [ ] Creare `test/sequence-response-variant` in `mockxy-acceptance-tests`.
- [ ] Inventariare i test legacy della vecchia gestione sequence.
- [ ] Rimuovere o riscrivere i test obsoleti.
- [ ] Aggiungere scenari di creazione/selezione/avanzamento/reset/disattivazione.
- [ ] Aggiungere scenari con più sequence e protezione dei riferimenti, se adatti al livello acceptance.
- [ ] Eseguire la suite acceptance pertinente.
- [ ] Committare le modifiche nel branch acceptance dedicato.

## 8. Chiusura

- [ ] Aggiornare questa checklist con tutti i punti completati.
- [ ] Committare integralmente implementazione e test nel feature branch.
- [ ] Lasciare il piano nel branch per la code review.
- [ ] Riportare branch, commit, test eseguiti e rischi residui.
