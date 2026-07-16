# I file dati e `data()`

I file dati sono dataset JSON riusabili, salvati nella cartella `files/` del
[workspace](WORKSPACE.md) e letti a runtime da [handler](HANDLER.md) e
[middleware](MIDDLEWARE.md) tramite l'accessor **`data(nome)`**. Separano i *dati* dalla
*logica*: lo script resta corto e leggibile, il dataset si modifica dalla pagina Dati (o con un
editor) senza toccare codice, e viaggia in git insieme ai mock.

## Il contratto su disco

- La cartella è **piatta**: nessuna sottocartella. Insieme al vincolo sui nomi, questo rende
  impossibile per costruzione qualunque attraversamento di percorso.
- I nomi ammessi sono composti da **minuscole, cifre, `.`, `_`, `-`**, con estensione `.json`.
  Il nome, senza estensione, è l'identificatore che si passa a `data()`.
- La forma canonica è **minuscola**: upload e rinomina normalizzano, così un workspace non può
  contenere `Utenti.json` e `utenti.json` che su Windows/macOS sarebbero lo stesso file e su
  Linux due diversi.

## `data()` a runtime

`await data("utenti")` restituisce il contenuto di `utenti.json` già parsato. Le proprietà da
conoscere:

- **lettura pigra**: un file mai referenziato non viene mai aperto;
- **rilettura a ogni chiamata**: niente cache — una modifica al file è visibile dalla richiesta
  successiva, senza riavvii;
- **copia per chiamata**: ogni handler riceve il proprio esemplare del dato; mutarlo non
  inquina le altre richieste né le successive;
- **errori espliciti**: nome non valido, file inesistente (il messaggio elenca i file
  disponibili, o segnala la cartella vuota), JSON malformato o cartella non configurata sono
  eccezioni con messaggi parlanti, che diventano il fallimento standard dello script — il `500`
  dell'handler con il dettaglio nel log, o il fail-open del middleware.

`data()` accetta anche nomi con maiuscole o con l'estensione di troppo (`data("Utenti.json")`)
e li normalizza alla forma canonica.

## La pagina Dati

La pagina Dati dell'interfaccia gestisce la cartella: caricamento (solo `.json`, anche in
blocco o per trascinamento), visualizzazione e modifica del contenuto, rinomina, eliminazione,
e il pulsante «copia riferimento» che produce lo snippet `data("nome")` pronto da incollare in
uno script. Il contenuto viene **validato come JSON prima di essere scritto**: un file
malformato viene rifiutato senza toccare il disco, e le scritture sono atomiche.

**Chi lo usa.** Ogni file mostra gli endpoint che lo referenziano: i sorgenti di handler e
middleware vengono scanditi in cerca delle chiamate `data("nome")` scritte come **stringa
letterale**. Un riferimento costruito a runtime (da variabile, per concatenazione) non è
individuabile: «nessun riferimento trovato» significa che non ne è stato trovato uno diretto,
non che il file sia certamente inutilizzato.

**Rinomina sicura.** Rinominando un file referenziato, viene proposto (attivo di default,
disattivabile) di riscrivere le occorrenze `data("vecchio")` → `data("nuovo")` nei sorgenti che
lo usano, con ricarica del runtime. La riscrittura è tutto-o-niente — o tutti i sorgenti o
nessuno — e il riepilogo finale riporta le occorrenze aggiornate, ricordando che gli eventuali
riferimenti dinamici vanno controllati a mano.

La pagina ricorda in `localStorage` l'ultimo file selezionato: tornando alla vista, anche dopo
un riavvio, ricarica quel file e la sua anteprima. Se il file non esiste più, la selezione
salvata viene ignorata; un upload completato seleziona invece il file appena caricato e mostra
subito il contenuto aggiornato.

## Dimensioni

Ogni chiamata `data()` rilegge e riparsa il file dal disco: fino al megabyte non si nota, ma un
file da svariati megabyte su un endpoint trafficato si paga a ogni richiesta. La pagina segnala
i file oltre i **5 MB**; il limite di caricamento è **25 MB** per file.

## Fuori dall'app desktop

Il server headless legge la stessa cartella tramite `FILES_DIR` (nel repo:
`workspace/files`), e l'immagine standalone la riceve in bind mount insieme ai mock — vedi
[l'anatomia del workspace](WORKSPACE.md). Senza cartella configurata, la prima chiamata
`data()` fallisce con un errore esplicito.
