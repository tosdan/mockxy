# 17 — La pagina Dati e `data()`

Un handler con cinquanta utenti incollati dentro lo script è illeggibile e non si mantiene. I
**file dati** separano i dati dalla logica: dataset JSON riusabili, salvati nella cartella
`files/` del workspace, gestiti dalla pagina **Dati** e letti a runtime da handler e
middleware con l'accessor **`data(nome)`**. Lo script resta corto, il dataset si modifica
senza toccare codice, e viaggia in git insieme ai mock.

## Il contratto su disco

- La cartella `files/` è **piatta**: nessuna sottocartella (insieme al vincolo sui nomi,
  esclude per costruzione qualunque attraversamento di percorso).
- Nomi ammessi: **minuscole, cifre, `.`, `_`, `-`**, con estensione `.json`. Il nome senza
  estensione è l'identificatore da passare a `data()`: `utenti.json` → `data("utenti")`.
- La forma canonica è **minuscola**: upload e rinomina normalizzano, così un workspace non
  può contenere `Utenti.json` e `utenti.json` — che su Windows e macOS sarebbero lo stesso
  file, e su Linux due diversi.

## `data()` a runtime

`await data("utenti")` restituisce il contenuto già parsato. Le proprietà da conoscere:

- **lettura pigra** — un file mai referenziato non viene mai aperto;
- **rilettura a ogni chiamata** — niente cache: una modifica al file è visibile dalla
  richiesta successiva, senza riavvii;
- **copia per chiamata** — ogni handler riceve il proprio esemplare: mutarlo (filtrarlo,
  ordinarlo, arricchirlo) non inquina le altre richieste;
- **errori espliciti** — nome non valido, file inesistente (il messaggio elenca i file
  disponibili), JSON malformato: eccezioni con messaggi parlanti, che diventano il consueto
  500 dell'handler (o il fail-open del middleware) con il dettaglio nel log.

`data()` tollera maiuscole o l'estensione di troppo nel riferimento (`data("Utenti.json")`)
e normalizza da sé.

## La pagina

La pagina Dati gestisce la cartella per intero:

- **caricamento** — solo `.json`, anche in blocco o per trascinamento; il contenuto viene
  **validato come JSON prima di essere scritto**: un file malformato è rifiutato senza
  toccare il disco. Ricaricare un file con lo stesso nome lo sostituisce;
- **anteprima e modifica** — selezionando un file se ne vede e modifica il contenuto;
- **copia riferimento** — produce lo snippet `data('nome')` pronto da incollare in uno
  script;
- **rinomina** ed **eliminazione**, con le tutele descritte sotto.

La pagina segnala i file **oltre i 5 MB** con un badge dedicato: ogni chiamata `data()`
rilegge e riparsa il file dal disco, e un file grande su un endpoint trafficato si paga a
ogni richiesta. Il limite di caricamento è 25 MB per file.

> 📷 **SCREENSHOT** — `17-pagina-dati.png`
> Cosa mostrare: la pagina Dati con alcuni file caricati, uno selezionato con l'anteprima
> del contenuto visibile e il badge «usato da N» in evidenza.

## La tracciabilità: chi usa cosa

Ogni file mostra **da quali endpoint è usato**: i sorgenti di handler e middleware vengono
scanditi in cerca delle chiamate `data("nome")` scritte come stringa letterale. Il badge
«usato da N» apre l'elenco degli endpoint. Un'avvertenza onesta accompagna la funzione: un
riferimento costruito a runtime (nome da variabile, concatenazione) non è individuabile —
«nessun riferimento trovato» significa nessun riferimento *diretto*, non che il file sia
certamente inutilizzato.

Su questa mappa si appoggiano due tutele:

- **rinomina sicura** — rinominando un file referenziato, l'opzione «aggiorna anche i
  riferimenti data() negli handler» (attiva di default) riscrive le occorrenze nei sorgenti
  che lo usano. La riscrittura è tutto-o-niente, con riepilogo finale e ricarica del runtime
  — e il promemoria di controllare a mano gli eventuali riferimenti dinamici;
- **avviso all'eliminazione** — eliminando un file usato, la conferma dichiara quanti
  endpoint si romperanno.

> 📷 **SCREENSHOT** — `17-rinomina-riferimenti.png`
> Cosa mostrare: un file in modalità rinomina con l'opzione «aggiorna anche i riferimenti
> data() negli handler (N)» visibile e attiva.

## Il pattern completo: dataset + handler

L'esempio che chiude il cerchio con il capitolo 15. Si carica `utenti.json` — cinquanta
utenti plausibili — nella pagina Dati, e l'handler di `GET /api/utenti` diventa cinque righe:

```js
module.exports = {
  async resolveResponse({ query, data }) {
    const utenti = await data("utenti");
    const attivi = utenti.filter((u) => u.attivo);
    return {
      jsonBody: query.q
        ? attivi.filter((u) => u.nome.toLowerCase().includes(String(query.q).toLowerCase()))
        : attivi,
    };
  },
};
```

La ricerca parziale che i filtri automatici del capitolo 11 non offrono, in un handler
leggibile — e il dataset si cura dalla pagina Dati, non nel codice. Aggiornare i dati della
demo non richiede di aprire uno script.

## Fuori dall'app desktop

Il server headless legge la stessa cartella tramite `FILES_DIR`, e l'immagine standalone la
riceve in bind mount insieme ai mock: gli handler con `data()` funzionano ovunque. Senza
cartella configurata, la prima chiamata fallisce con un errore esplicito.

Con dati e logica al loro posto, restano i protocolli che non sono richiesta/risposta: gli
stream. Si comincia dai [Server-Sent Events](18-sse.md).
