# Mockxy 1.8.0

## Italiano

La 1.8.0 è un secondo giro sull'interfaccia. Le righe si spuntano senza caselle, la riga aperta
si segna dal lato del dettaglio, Monitor e Storico condividono lo stesso dettaglio, e tastiera e
screen reader trovano nomi e fuoco dove servono. **Nessun intervento sui workspace.** L'admin API
ha una sola aggiunta, compatibile.

- **Selezione:**
  - **Senza caselle:** nel catalogo, nel Monitor e nello Storico un clic apre la riga e
    **Ctrl+clic** la spunta. Il pulsante **Seleziona** avvia una modalità in cui il clic spunta;
    **Esc** annulla.
  - **Intervalli:** nel Monitor e nello Storico Maiuscole+clic spunta ancora l'intervallo; nel
    catalogo si spunta per endpoint o per collezione intera.
  - **Segni:** le righe spuntate hanno tinta e bordo sinistro indaco. Le collezioni spuntate in
    parte hanno strisce, bordo tratteggiato e il contatore «spuntati/totale».
- **Riga aperta:** nel catalogo, nel Monitor, nello Storico e nella pagina Dati la sfumatura va
  verso destra, dal lato del dettaglio. Nel Monitor la barra ambra delle non mockate resta
  visibile anche sulla riga aperta.
- **Catalogo:** niente più righe verticali dell'indentazione. Il menu «Nuovo» mostra le icone del
  tipo.
- **Dettaglio dell'endpoint:**
  - **Varianti:** la tendina mostra l'icona del tipo e resta leggibile anche stretta. Il
    riepilogo della sequenza dice il titolo di ogni passo.
  - **«Duplica in…»:** la finestra non mostra più un errore all'apertura, e spiega i conflitti in
    italiano.
  - **Testi più chiari:** il chip dice «SEQ 2 passi». Il ritardo compare solo dove ha effetto.
- **Monitor e Storico:** un dettaglio solo. Lo Storico mostra il nome dello status, il passo di
  sequenza e l'errore di shared state.
- **Dati:**
  - **Rinomina ed eliminazione:** si fanno da tastiera senza perdere il fuoco.
  - **Elenco:** si scorre con le frecce e si ridimensiona.
  - **«Usato da»:** apre l'endpoint nel catalogo.
  - **Stato runtime:** è tradotto.
- **Accessibilità:**
  - **Colori:** le icone prendono i colori previsti.
  - **Fuoco:** gli anelli superano 3:1.
  - **Nomi:** ogni finestra prende il nome dal suo titolo, la X si chiama «Chiudi», e le caselle
    hanno di nuovo il loro nome.
  - **Tooltip:** nessuno resta più orfano nell'angolo.
  - **axe-core:** nessuna violazione negli stati verificati.
- **Admin API:** il `409` di un endpoint che esiste già (`POST /mocks`, `POST /mocks/:id/copy`)
  porta `details.code: "ENDPOINT_EXISTS"`. Messaggio e status non cambiano.
- **Skill:** le skill alla tag `v1.8.0` descrivono l'admin API di questa versione.

[Catalogo](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/it/CATALOGO.md)
· [Monitor](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/it/MONITOR.md)
· [Storico](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/it/STORICO.md)
· [Dati](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/it/DATI.md)
· [Admin API](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/it/ADMIN-API.md)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/progetto/NOTE-RILASCIO-next.md#v180)

## English

Version 1.8.0 is a second pass on the interface. Rows are checked without checkboxes, the open
row is marked on the side of the detail, the Monitor and the History page share one detail, and
keyboard and screen readers find names and focus where they need them. **Workspaces need no
change.** The admin API has a single, compatible addition.

- **Selection:**
  - **No checkboxes:** in the catalog, the Monitor and the History page a click opens a row and
    **Ctrl+click** checks it. The **Select** button starts a mode where a click checks; **Esc**
    clears.
  - **Ranges:** in the Monitor and the History page Shift+click still checks a range; in the
    catalog you check single endpoints or whole collections.
  - **Marks:** checked rows have an indigo tint and left edge. Partly checked collections have
    stripes, a dashed edge and a «checked/total» counter.
- **Open row:** in the catalog, the Monitor, the History page and the Data page the gradient
  grows towards the right, on the detail's side. In the Monitor the amber bar of not mocked
  requests now stays visible on the open row.
- **Catalog:** no more vertical indent guides. The «New» menu shows the type icons.
- **Endpoint detail:**
  - **Variants:** the picker shows the type icon and stays readable when narrow. The sequence
    summary tells each step's title.
  - **«Duplicate to…»:** the dialog no longer shows an error when it opens, and explains
    conflicts in the app's language.
  - **Clearer texts:** the chip reads «SEQ 2 steps». The delay shows only where it has an effect.
- **Monitor and History:** one detail. The History page shows the status name, the sequence step
  and the shared-state error.
- **Data:**
  - **Rename and delete:** they work from the keyboard without losing focus.
  - **List:** it is browsed with the arrows and is resizable.
  - **«Used by»:** it opens the endpoint in the catalog.
  - **Runtime status:** it is translated.
- **Accessibility:**
  - **Colors:** icons take their intended colors.
  - **Focus:** rings are above 3:1.
  - **Names:** every dialog is named after its title, the X is named «Close», and checkboxes
    have their name again.
  - **Tooltips:** none is left behind in the corner anymore.
  - **axe-core:** no violations in the checked states.
- **Admin API:** the `409` for an endpoint that already exists (`POST /mocks`,
  `POST /mocks/:id/copy`) carries `details.code: "ENDPOINT_EXISTS"`. Message and status are
  unchanged.
- **Skills:** the skills at tag `v1.8.0` describe this version's admin API.

[Catalog](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/en/CATALOGO.md)
· [Monitor](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/en/MONITOR.md)
· [History](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/en/STORICO.md)
· [Data](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/en/DATI.md)
· [Admin API](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/en/ADMIN-API.md)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.8.0/docs/progetto/NOTE-RILASCIO-next.md#v180)

## Download

- **Windows x64:** `Mockxy-1.8.0-portable.exe`
- **Linux x64:** `Mockxy-1.8.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.7.1...v1.8.0)
