# Mockxy 1.7.0

## Italiano

La 1.7.0 è dedicata all'interfaccia: catalogo, Monitor, Storico ed editor di codice ora
condividono lo stesso modo di selezionare e di usare la tastiera, la stessa testata e le stesse
icone per dire chi ha servito una richiesta. **Nessun intervento sui workspace.** L'admin API
cambia in tre punti, uno incompatibile per chi crea una collezione chiamata «Non assegnati».

- **Catalogo:**
  - **Filtri:** sotto filtro conta i risultati sul totale ed evidenzia il testo cercato.
  - **Percorsi:** si troncano in testa, così resta visibile la parte che li distingue.
  - **Tastiera:** il catalogo si usa con un solo punto di Tab; Invio apre, Spazio spunta.
  - **Collezioni:** hanno una casella che spunta tutto il sottoalbero.
  - **Densità compatta:** un'opzione del menu «⋮», una riga per endpoint.
- **Monitor:**
  - **Selezione:** stessa selezione del catalogo, con le azioni in una barra in fondo alla lista.
  - **Errori:** si contano sui chip di stato, divisi fra 4xx e 5xx.
  - **Non mockate:** un chip spiega la barra ambra delle richieste non mockate e le filtra con
    un clic.
  - **Densità compatta:** anche qui, dal menu «⋮».
- **Storico:**
  - **Ordine:** parte dalla richiesta più recente.
  - **Voci:** ogni voce dice quando è arrivata, chi l'ha servita e la latenza.
  - **Filtri:** sono quelli del Monitor e cercano in tutto l'archivio.
- **Icone di provenienza:** mock, handler, middleware, proxy, SSE, WebSocket, miss e passi di
  sequenza hanno ciascuno un'icona oltre al colore, nel Monitor, nello Storico e nel tipo degli
  endpoint del catalogo.
- **Editor di codice:**
  - **Contrasto:** numeri di riga, commenti e punteggiatura sono più leggibili, e nel testo
    selezionato o trovato con la ricerca i caratteri restano leggibili.
  - **Lingua:** il pannello di ricerca e sostituzione e gli altri testi di CodeMirror seguono la
    lingua dell'app.
- **Accessibilità:** axe-core non segnala violazioni su catalogo, Monitor, Storico e Dati.
- **Admin API:**
  - **Collezioni:** `POST /mocks/collections` riserva anche il nome «Non assegnati» oltre a
    «Unsorted», e il `409` porta `details.code: COLLECTION_LABEL_RESERVED`.
  - **Lettura dello Storico:** `GET /monitoring/dumps/read` filtra tutto l'archivio, riprende dal
    byte con `byteOffset` e con `order=desc` legge dalla voce più recente.
  - **Ordine dei file:** i file di dump sono elencati per sessione e numero di rotazione, quindi
    un `fileIndex` di una versione precedente non va riusato.
- **Skill:** le skill alla tag `v1.7.0` descrivono l'admin API di questa versione.

[Catalogo](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/it/CATALOGO.md)
· [Monitor](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/it/MONITOR.md)
· [Storico](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/it/STORICO.md)
· [Admin API](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/it/ADMIN-API.md)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/progetto/NOTE-RILASCIO-next.md#v170)

## English

Version 1.7.0 is about the interface: the catalog, the Monitor, the History page and the code
editor now share the same way of selecting and using the keyboard, the same header and the same
icons telling what served a request. **Workspaces need no change.** The admin API changes in
three places, one of them incompatible for clients creating a collection named «Non assegnati».

- **Catalog:**
  - **Filters:** under a filter it counts the results out of the total and highlights the
    searched text.
  - **Paths:** they are truncated at the head, so the part that tells them apart stays visible.
  - **Keyboard:** the catalog works with a single Tab stop; Enter opens, Space checks.
  - **Collections:** they have a checkbox that checks their whole subtree.
  - **Compact density:** an option of the «⋮» menu, one line per endpoint.
- **Monitor:**
  - **Selection:** the same selection as the catalog, with the actions in a bar at the bottom of
    the list.
  - **Errors:** they are counted on the status chips, split into 4xx and 5xx.
  - **Not mocked:** a chip explains the amber bar of the not mocked requests and filters them
    with a click.
  - **Compact density:** here too, from the «⋮» menu.
- **History:**
  - **Order:** it starts from the most recent request.
  - **Entries:** each entry tells when it arrived, what served it and its latency.
  - **Filters:** the Monitor's filters search the whole archive.
- **Source icons:** mock, handler, middleware, proxy, SSE, WebSocket, miss and sequence steps
  each have an icon besides their color, in the Monitor, in the History page and in the
  catalog's endpoint types.
- **Code editor:**
  - **Contrast:** line numbers, comments and punctuation are easier to read, and selected text
    or search results stay readable.
  - **Language:** the search and replace panel and CodeMirror's other texts follow the app's
    language.
- **Accessibility:** axe-core reports no violations on the catalog, the Monitor, the History
  page and the Data page.
- **Admin API:**
  - **Collections:** `POST /mocks/collections` reserves the name «Non assegnati» as well as
    «Unsorted», and the `409` carries `details.code: COLLECTION_LABEL_RESERVED`.
  - **History reading:** `GET /monitoring/dumps/read` filters the whole archive, resumes from a
    byte with `byteOffset`, and with `order=desc` reads from the newest entry.
  - **File order:** dump files are listed by session and rotation number, so a `fileIndex` from
    an earlier version should not be reused.
- **Skills:** the skills at tag `v1.7.0` describe this version's admin API.

[Catalog](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/en/CATALOGO.md)
· [Monitor](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/en/MONITOR.md)
· [History](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/en/STORICO.md)
· [Admin API](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/en/ADMIN-API.md)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.7.0/docs/progetto/NOTE-RILASCIO-next.md#v170)

## Download

- **Windows x64:** `Mockxy-1.7.0-portable.exe`
- **Linux x64:** `Mockxy-1.7.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.6.0...v1.7.0)
