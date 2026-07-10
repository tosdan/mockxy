# Idee per implementazioni future

Funzionalità che i dev server e i proxy da sviluppo più usati offrono e che a Mockxy mancano.
Nate da una rassegna del 10 luglio 2026 (Vite/ng serve, webpack-dev-server, json-server,
Mockoon, WireMock, Charles/mitmproxy), filtrate su ciò che ha senso dentro Mockxy e i suoi
scenari d'uso (vedi `docs/it/SCENARI.md`). Non è un impegno: è il vivaio da cui pescare. Le voci
si spostano in `BACKLOG-PRODOTTO.md` quando si decide di lavorarci, e si cancellano se
implementate o scartate con decisione esplicita.

Già coperto da Mockxy e quindi fuori lista: proxy verso il backend con fallback, ritardo
configurabile (per mock e globale), gestione CORS, adattamento cookie, riscrittura redirect,
reload a caldo dei mock, cattura del traffico → mock, import OpenAPI.

## In cima (le tre a miglior rapporto valore/costo)

### 1. Segnaposto dinamici nei body dei mock

Oggi tra il mock statico e l'handler JavaScript non c'è niente in mezzo: se la risposta di
`/api/utenti/:id` deve contenere l'id richiesto invece di un valore fisso, serve un handler.
Strumenti come json-server e Mockoon offrono segnaposto direttamente nel body:
`{"id": "{{params.id}}", "creato": "{{now}}"}`. È il buco osservato nel collaudo del 9 lug
(il mock nato dalla cattura di un POST che rigioca per sempre l'eco vecchia; il body statico
anche cambiando id nel percorso). Coprirebbe gran parte dei casi in cui oggi serve un handler,
con un decimo dello sforzo per l'utente. Da definire: set minimo dei segnaposto (params, query,
header della richiesta, timestamp; eventuali generatori casuali con parsimonia — vale il
principio dell'import OpenAPI: base solida da ritoccare, non dati perfetti).

### 2. Scenari di varianti attivabili in un colpo

Il sistema delle varianti esiste: ogni endpoint ha più response, una è selezionata. Manca il
livello sopra: un preset con un nome — "giornata di errori", "utente senza dati", "percorso
felice" — che con un click imposta la variante selezionata su molti endpoint insieme.
WireMock e Mockoon costruiscono interi flussi di test su questo concetto. Per chi testa un
frontend è il passaggio istantaneo tra stati del mondo senza toccare dieci endpoint a mano.
Da definire: dove vivono i preset (file nel workspace, condivisibile col team), cosa salvano
(solo la selezione delle varianti? anche enabled/disabled?).

### 3. Import da HAR

I mock oggi nascono dal traffico catturato live o dall'import OpenAPI. Il terzo affluente
naturale è il file HAR che qualunque browser esporta dal pannello di rete: un collega manda
l'HAR di un bug, lo importi, e il workspace riproduce quella sessione. La conversione
richiesta→mock esiste già (è quella della cattura); mancherebbe il parser del formato e la
stessa politica dell'import OpenAPI per i duplicati (gli endpoint esistenti non si toccano).

## Da tenere d'occhio

### 4. Più backend upstream, per prefisso di percorso

Il `proxy.conf.json` di Angular permette "`/api` va sul servizio A, `/auth` sul servizio B".
Mockxy ha un solo backend per workspace: chi lavora con più microservizi deve mettere un altro
proxy davanti — che è il lavoro che Mockxy dovrebbe assorbire. Regole di instradamento per
prefisso verso più upstream. Tocca la config del workspace e il cuore del proxy: da progettare
con calma.

### 5. HTTPS locale

Vite e ng serve hanno il flag per servire in HTTPS; Caddy genera i certificati da solo. Serve
appena il frontend richiede un contesto sicuro: service worker, cookie Secure, SameSite=None —
e Mockxy adatta già i cookie del proxy, il tema è contiguo. Strada battuta: integrazione con
mkcert oppure certificato self-signed generato al volo, con le istruzioni per fidarsene.

### 6. Iniezione di guasti e condizioni di rete

Oltre il ritardo fisso: "il 10% delle richieste su questa rotta fallisce con 500", ritardo
casuale in un intervallo, profili tipo "3G lento". È come si testa la resilienza di un frontend
(retry, spinner, stati di errore) senza scrivere codice. Si innesta bene sul sistema delle
varianti (una variante di guasto estratta a sorte con un peso).

## Piccolezze quasi gratis

7. **Banner per i file rotti del workspace**: l'admin API espone già l'elenco (`loadErrors` in
   `GET /_admin/api/mocks`, aggiunto il 9 lug); manca solo mostrarlo nella UI invece di lasciare
   gli endpoint sparire in silenzio dal catalogo.
8. **QR code per l'indirizzo LAN**: quando il server è esposto in rete, mostrare l'URL di rete
   con un QR da inquadrare col telefono. Chi prova il frontend da mobile lo usa ogni giorno.

## Considerate e scartate (per non riproporle senza motivo nuovo)

- **Live-reload della pagina del browser**: è il mestiere del dev server del frontend, non del
  mock server.
- **Tunnel pubblici stile ngrok**: aprono un tema di sicurezza sproporzionato rispetto al valore.
- **Mocking GraphQL e WebSocket**: differenzianti veri ma progetti interi; da rivalutare solo
  davanti a una domanda concreta.
