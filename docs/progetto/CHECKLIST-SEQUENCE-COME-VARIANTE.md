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
- [ ] Piano e checklist committati nel feature branch.

## 1. Modello e runtime

- [ ] Trasformare il normalizzatore in configurazione di response sequence, senza `enabled`.
- [ ] Includere il filename della sequence nella firma runtime.
- [ ] Rifiutare esplicitamente `endpoint.sequence`.
- [ ] Caricare `type: "sequence"` dalla response selezionata.
- [ ] Risolvere e validare integralmente gli step `mock`/`handler`.
- [ ] Rifiutare step `sequence`, `middleware`, `sse` e `ws`.
- [ ] Registrare e servire la route sequence attraverso la pipeline esistente.
- [ ] Riconciliare cursore e handler state alle transizioni di scenario.
- [ ] Conservare lo stato sui reload semanticamente invarianti e sul graft della route precedente.
- [ ] Rendere il reload accodato attendibile dai chiamanti e restituirne l'esito.
- [ ] Aggiornare i test unitari di config, state, loader, serving e watch.

## 2. Admin API e persistenza

- [ ] Leggere, normalizzare e riepilogare response `sequence`.
- [ ] Esporre `sequence`, `sequenceState` e la nuova semantica di `sequenceActive`.
- [ ] Creare una response sequence e selezionarla.
- [ ] Modificare una response sequence per filename.
- [ ] Validare tutto il grafo prima del successo di create/update/select/copy.
- [ ] Collegare l'ack strict del reload al rollback delle mutazioni admin.
- [ ] Rimuovere e rifiutare il vecchio ramo `PUT { sequence }`.
- [ ] Aggiornare selezione e reset sulla sequence selezionata.
- [ ] Aggiungere `GET /mocks/:id/sequence/state`.
- [ ] Costruire l'indice locale delle dipendenze tra response.
- [ ] Rifiutare con `409` la cancellazione di target referenziati.
- [ ] Supportare clone di response sequence.
- [ ] Copiare la chiusura minima con `copyResponses: false`.
- [ ] Aggiornare i test admin, CRUD, rollback, copia e cancellazione.

## 3. Contratto pubblico

- [ ] Aggiornare `docs/admin-api.openapi.yaml`.
- [ ] Aggiungere gli schemi request/response della variante sequence.
- [ ] Rimuovere sequence da endpoint e dal vecchio update.
- [ ] Documentare state/reset e cancellazione `409`.
- [ ] Eseguire i test di validità del contratto OpenAPI.

## 4. UI

- [ ] Aggiungere `sequence` a `MockType`.
- [ ] Separare i tipi creabili come endpoint/form generico dal tipo generale.
- [ ] Aggiungere tipi request/detail/state della sequence.
- [ ] Aggiornare service e store per create/update/select/reset/state.
- [ ] Convertire il dialog in modalità create/edit senza toggle `enabled`.
- [ ] Rappresentare `times`/`forMs` per singolo step senza perdita.
- [ ] Filtrare gli step con allow-list `mock|handler`.
- [ ] Aggiungere titolo, validazione, snapshot, reset e polling cancellabile.
- [ ] Mostrare il riepilogo sequence nel dettaglio senza usare il form generico.
- [ ] Aggiungere Sequence al menu response e al pulsante scorciatoia.
- [ ] Aggiornare catalogo, filtro, badge, token colore e icone.
- [ ] Aggiornare i18n italiana e inglese.
- [ ] Aggiornare test service/store/component e controlli accessibilità.
- [ ] Verificare build frontend.

## 5. Migrazione e documentazione

- [ ] Decidere durante l'implementazione se includere il migratore una tantum.
- [ ] Se incluso, aggiungere dry-run, backup, idempotenza e test.
- [ ] Aggiornare `DESIGN-SEQUENZE.md` al nuovo modello.
- [ ] Aggiornare documentazione endpoint/response/catalogo/admin API in italiano e inglese.
- [ ] Aggiornare README e fixture interessate.
- [ ] Verificare che nessuna documentazione pubblica descriva ancora `endpoint.sequence`.

## 6. Verifica app

- [ ] Suite backend completa verde.
- [ ] Suite frontend completa verde.
- [ ] Build frontend verde.
- [ ] E2E interni pertinenti aggiornati e verdi.
- [ ] `git diff --check` pulito.
- [ ] Riesame finale dei criteri di accettazione del piano.

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
