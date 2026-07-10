# Collegare il frontend a Mockxy

L'idea è una sola: l'applicazione deve parlare con Mockxy invece che con il backend, e Mockxy
deve sapere dov'è il backend vero (`BACKEND_URL`). Per il *come*, le strade sono due — e la
scelta determina se il CORS entra in gioco oppure no.

## Strada A: il proxy del dev server (consigliata)

Il dev server del frontend inoltra a Mockxy le chiamate API: il browser vede **un'origin sola**
e il CORS non esiste proprio. Le chiamate nel codice restano relative (`/api/...`), cambia solo
la configurazione del proxy.

Angular (`proxy.conf.json`):

```json
{ "/api": { "target": "http://localhost:3000", "secure": false } }
```

Vite (`vite.config.js`):

```js
export default { server: { proxy: { "/api": "http://localhost:3000" } } };
```

Vantaggi: zero configurazione lato Mockxy, cookie e sessioni senza pensieri (tutto
same-origin), nessuna differenza col deploy (dove il reverse proxy fa lo stesso lavoro).

## Strada B: chiamata diretta cross-origin

Il frontend punta direttamente a `http://localhost:3000` (o all'IP del server in LAN) come base
URL. Attenzione: `localhost:4200` e `localhost:3000` sono **origin diverse** — per l'origin
conta anche la porta — quindi il browser applica il CORS a ogni chiamata.

Cosa serve:

1. **[CORS automatico](CORS.md) attivo** (`CORS_ENABLED=true`, o l'interruttore nella dialog
   del workspace): senza, la prima chiamata muore con il classico errore su
   `Access-Control-Allow-Origin` in console;
2. per le sessioni a cookie, `withCredentials: true` (HttpClient/XHR) o
   `credentials: 'include'` (fetch) — e il login **deve passare da Mockxy**
   ([i cookie attraverso il proxy](COOKIE.md));
3. niente, invece, per l'autenticazione a token nell'header: il preflight a eco la copre già.

È la strada naturale quando non c'è un dev server con proxy (app statiche, strumenti terzi) o
quando il server è [esposto in LAN](RETE.md) per i colleghi. Il limite noto: sessioni a cookie
tra *site* diversi su http non sono possibili per le regole del browser — lì si usa il token.

## Verificare che tutto passi da Mockxy

Qualunque strada si scelga, la prova del nove è il [monitor](MONITOR.md): ogni chiamata
dell'app deve comparirvi, con la provenienza giusta (`x-mock-source`). Se una chiamata non
compare, sta ancora andando al backend diretto — un base URL dimenticato, una regola di proxy
che non copre quel prefisso.
