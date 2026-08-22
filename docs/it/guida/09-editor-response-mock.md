# 09 — L'editor delle response mock

Questo capitolo percorre l'editor di una response statica controllo per controllo: status,
titolo, ritardo, header, e il body nelle sue tre forme. È il ferro del mestiere quotidiano —
tutto ciò che serve per costruire risposte precise, realistiche e pronte per i casi d'errore.

> 📷 **SCREENSHOT** — `09-editor-json.png`
> Cosa mostrare: l'editor di una response mock nella configurazione più comune — status 200,
> due o tre header valorizzati, body JSON realistico nell'editor con evidenziazione della
> sintassi, campo delay visibile.

## Titolo, status e delay

- **Titolo** — l'etichetta della variante nella lista delle response. Conviene tenerlo
  descrittivo del *caso* («Utente trovato», «Carrello vuoto», «Errore server»), non del
  contenuto tecnico.
- **Status** — il combobox suggerisce i codici comuni con la loro descrizione, ma accetta
  qualunque intero tra 100 e 599: anche un 418 o un codice custom aziendale, se serve.
- **Delay (ms)** — il ritardo applicato prima di rispondere, proprio di questa variante.
  Utile per il singolo endpoint lento (la ricerca pesante, l'export). Quando è maggiore di
  zero vince sul ritardo globale del workspace — i due non si sommano; il quadro dei ritardi
  è nel [capitolo 14](14-ritardi.md).

## Gli header

Gli header si aggiungono riga per riga: il nome con un combobox che suggerisce gli header
noti (ma accetta qualunque nome), il valore libero, la rimozione per riga.

Il menu **«Inserisci bundle»** aggiunge set di header pronti per i casi ricorrenti:

- **CORS (sviluppo)** — gli header di permesso cross-origin per una risposta, quando si
  gestisce il CORS a mano sul singolo mock invece che con l'opzione automatica;
- **CORS preflight** — il set per una risposta `OPTIONS` di preflight;
- **No-cache** — le direttive che impediscono al browser di cachare la risposta: la
  contromisura al classico «ho cambiato il mock ma vedo ancora i dati vecchi»;
- **Security headers** — gli header di sicurezza standard, per riprodurre le risposte di un
  backend che li imposta;
- **Auth: Bearer** — l'intestazione di autorizzazione d'esempio.

Un bundle inserisce le righe; i valori restano poi modificabili una a una.

> 📷 **SCREENSHOT** — `09-bundle-header.png`
> Cosa mostrare: il menu «Inserisci bundle» aperto sopra la lista degli header, con i bundle
> disponibili in elenco.

## Il body: tre forme

### JSON

La modalità di default. L'editor valida la sintassi mentre si scrive e **un JSON rotto non
viene salvato**: il messaggio «JSON non valido» blocca il salvataggio finché il documento non
torna corretto. Se il body è una lista, la risposta partecipa automaticamente a paginazione e
filtri sulle query string ([capitolo 11](11-liste-paginazione-filtri.md)).

### Testo

Per tutto ciò che non è JSON: XML, CSV, HTML, testo semplice. In modalità testo il contenuto
viene servito **così com'è**, e il content-type lo dichiari tu: il controllo dedicato imposta
l'header `content-type` (l'editor propone `text/plain` come base). È la strada per mockare
l'export CSV, la risposta SOAP, la pagina d'errore HTML.

### File

Per i payload binari o pesanti — immagini, PDF, archivi, video — la sorgente «File» accetta
un caricamento con trascinamento o click (fino a **12 MB** dall'interfaccia). Il file viene
salvato accanto alla response e servito **in streaming a ogni richiesta**: il contenuto non
passa mai per la memoria del server, quindi anche download da centinaia di MB (per file
portati nel workspace a mano) non pesano. Il content-type viene dedotto dal file ed è
sovrascrivibile con un header esplicito; senza indicazioni, la risposta esce come
`application/octet-stream`.

Il caso d'uso tipico: l'endpoint `GET /api/documenti/:id/pdf` che il frontend usa per il
pulsante di download — si carica un PDF d'esempio e il flusso di download si prova per
intero, barra di avanzamento inclusa.

> 📷 **SCREENSHOT** — `09-editor-file.png`
> Cosa mostrare: l'editor in modalità body-da-file con un file già caricato (es. un PDF):
> nome del file, hint sul content-type e zona di sostituzione per trascinamento. Serve a
> mostrare lo stato alternativo dell'editor rispetto allo screenshot JSON.

## I preset di response

Il menu **«Preset response»** applica in un colpo status e body pronti per i casi standard:
gli errori **400, 401, 403, 404, 409, 422, 429, 500, 503** — ciascuno con un body d'errore
plausibile — e **«Lista paginata»**, che imposta un body-lista d'esempio pronto per la
paginazione automatica. L'applicazione chiede conferma, perché **sostituisce** status e body
correnti.

I preset d'errore sono l'acceleratore per la pratica raccomandata nel capitolo 8: dare a ogni
endpoint importante la sua variante d'errore. Nuova response → preset «500 Internal Server
Error» → titolo «Errore server» → salva: dieci secondi, e il caso di test è pronto per
sempre.

> 📷 **SCREENSHOT** — `09-preset-response.png`
> Cosa mostrare: il menu dei preset aperto, con gli errori HTTP e «Lista paginata» in elenco;
> idealmente anche la dialog di conferma della sostituzione.

## L'interruttore Template

Sui body JSON e testo, l'interruttore **Template** abilita i placeholder `{{...}}` — valori
della richiesta e helper generati direttamente nel body e negli header. È un cambio di natura
abbastanza importante da meritare un capitolo intero, il [prossimo](10-templating.md).

## L'editor di codice

I campi body (e gli script, più avanti) usano un editor con evidenziazione della sintassi,
ricerca e sostituzione, formattazione/indentazione automatica del documento, commento riga e
folding delle sezioni. L'elenco completo delle scorciatoie è nella dialog dedicata
dell'interfaccia, riassunta nelle [appendici](34-appendici.md).

## Salvare

**Salva** valida e scrive: su disco la modifica è un normale salvataggio del file di
risposta, e l'endpoint la serve dalla richiesta successiva — nessun riavvio, nessun passaggio
intermedio. **Annulla** scarta la bozza e richiude l'editor.

Con l'editor in mano, i tre capitoli successivi ne moltiplicano il valore: il
[templating](10-templating.md), le [liste automatiche](11-liste-paginazione-filtri.md) e le
[sequenze](12-sequenze.md).
