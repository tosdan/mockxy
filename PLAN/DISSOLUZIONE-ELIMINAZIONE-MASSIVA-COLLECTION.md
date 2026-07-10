# Piano — dissoluzione ed eliminazione massiva delle collection

## Obiettivo

Distinguere nel catalogo due operazioni intenzionalmente diverse:

- **Dissolvi collection / Dissolve collection**: rimuove la collection e le sotto-collection,
  preserva tutti gli endpoint e li sposta in Unsorted;
- **Elimina collection / Erase collection**: elimina definitivamente la collection, le
  sotto-collection, gli endpoint contenuti e tutte le relative varianti.

La collection virtuale **Unsorted** espone soltanto **Elimina tutti gli endpoint / Erase all
endpoints**, che cancella tutti gli endpoint non assegnati, anche se nascosti dai filtri correnti.

## UX

1. Ogni riga collection, inclusa Unsorted, espone il menu ellipsis.
2. Le collection persistite mostrano le azioni `Dissolvi collection` con icona `lucideUngroup` e
   `Elimina collection` con icona `lucideTrash2` e stile distruttivo.
3. Unsorted mostra soltanto `Elimina tutti gli endpoint`, con icona `lucideTrash2`.
4. Ogni azione ha a destra una `lucideInfo`; dopo 250 ms di hover compare un tooltip che ne spiega
   gli effetti. Le traduzioni inglesi usano `Dissolve` ed `Erase` per rendere le azioni distinguibili
   anche a colpo d'occhio.
5. Prima dell'esecuzione compare una conferma inline con il numero ricorsivo di endpoint coinvolti.
   Il click sui controlli non deve collassare la collection.
6. Durante un'operazione Erase non sono accettate doppie conferme. Al successo catalogo e selezione
   vengono riallineati; in caso di errore lo stato visibile resta invariato.

## Backend e contratto API

- Mantenere `DELETE /_admin/api/mocks/collections/:id` con semantica **Dissolve**.
- Aggiungere `DELETE /_admin/api/mocks/collections/:id/contents` con semantica **Erase** e risposta
  `{ deleted: number }`. L'id riservato `unsorted` elimina solo gli endpoint privi di membership.
- Eseguire Erase come singola transazione logica serializzata per workspace: backup di endpoint,
  directory delle response e `.collections.json`; aggiornamento di membership e `childOrder`; un
  solo reload del runtime; rollback integrale se un passo o il reload falliscono.
- Per una collection persistita includere ricorsivamente tutte le sotto-collection. Collection ed
  endpoint esterni al sottoalbero non devono cambiare.

## Frontend

- Esporre `eraseCollection(id)` nel client API e il relativo tipo di risposta.
- Aggiungere nello store la mutazione Erase, il refresh del catalogo, la deselezione degli endpoint
  rimossi e uno stato dedicato per impedire richieste duplicate.
- Separare il menu di Unsorted dal menu delle collection persistite e usare traduzioni/tooltip
  specifici in italiano e inglese.

## Verifica

- Test API per Erase su Unsorted, su un sottoalbero annidato e su collection esterne preservate.
- Test di rollback con reload fallito, includendo endpoint, response e metadati.
- Test del client HTTP e dello store per refresh, deselezione ed errore.
- Test del conteggio ricorsivo degli endpoint coinvolti.
- Suite backend e frontend complete, build frontend desktop e controllo `git diff --check`.

## Criteri di accettazione

- Dissolve conserva tutti gli endpoint e li porta in Unsorted.
- Erase elimina tutti e soli gli endpoint del sottoalbero selezionato, oppure tutti e soli gli
  endpoint Unsorted quando invocato sulla collection virtuale.
- Le due azioni sono chiaramente distinguibili per iniziale, etichetta, icona, colore e tooltip.
- Nessun errore lascia file, response o riferimenti di collection in uno stato parziale.
