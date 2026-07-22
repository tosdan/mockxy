# 04 — Collegare la tua web app a Mockxy

L'idea è una sola: l'applicazione deve parlare con **Mockxy** invece che con il backend, e
Mockxy deve sapere dov'è il **backend vero**. Il secondo punto è una singola impostazione —
`BACKEND_URL` nella configurazione headless, o il campo «Backend URL» nelle impostazioni del
workspace dell'app desktop. Per il primo, le strade sono due, e la scelta determina se il
CORS entra in gioco oppure no.

La catena completa, nella configurazione consigliata:

```
browser ──▶ dev server del frontend ──▶ Mockxy ──▶ backend reale
            (proxy: /api → Mockxy)      (mock, o inoltro)
```

Ogni anello si configura nel proprio posto: il proxy sul dev server del frontend, il backend
su Mockxy. Il codice dell'applicazione non cambia.

## Strada A: il proxy del dev server (consigliata)

I dev server dei framework frontend includono tutti un proxy: le richieste che arrivano al
dev server su certi prefissi (tipicamente `/api`) vengono inoltrate a un'altra destinazione.
Basta puntare quel proxy a Mockxy: le chiamate nel codice restano relative (`/api/...`), e
il browser continua a vedere **un'origin sola** — quella del dev server.

Angular (`proxy.conf.json`):

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false
  }
}
```

Vite (`vite.config.js`):

```js
export default {
  server: {
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
};
```

La meccanica è identica con webpack devServer, Create React App (`proxy` nel `package.json` o
`setupProxy.js`) e gli altri: si inoltra il prefisso delle API all'indirizzo di Mockxy.

I vantaggi di questa strada:

- **il CORS non esiste proprio** — per il browser è tutto same-origin;
- cookie e sessioni funzionano senza pensieri, per lo stesso motivo;
- nessuna differenza con il deploy, dove un reverse proxy fa lo stesso lavoro del dev server;
- zero configurazione lato Mockxy.

## Strada B: chiamata diretta cross-origin

L'alternativa è puntare il frontend **direttamente** a Mockxy: base URL delle API
`http://localhost:3000` (o l'IP del server, se esposto in LAN). Funziona, ma il browser
applica il CORS a ogni chiamata — e qui serve una precisazione, perché è il primo ostacolo
in cui si inciampa.

**CORS in breve.** Il browser considera due indirizzi la stessa *origin* solo se coincidono
schema, host **e porta**: `http://localhost:4200` e `http://localhost:3000` sono origin
diverse, anche se entrambe "in locale". Quando una pagina fa una richiesta verso un'altra
origin, il browser pretende che il server di destinazione dichiari esplicitamente di
accettarla (header `Access-Control-Allow-Origin`, e per le richieste non semplici una
richiesta preliminare `OPTIONS`, il *preflight*). Senza quelle dichiarazioni, la chiamata
viene bloccata dal browser con il classico errore CORS in console — il server l'ha anche
servita, ma la pagina non può leggerla.

Con la strada B servono quindi:

1. il **CORS automatico** di Mockxy attivo (`CORS_ENABLED=true` in headless, o
   l'interruttore «CORS automatico» nelle impostazioni del workspace): Mockxy risponde da sé
   ai preflight e imposta gli header CORS su ogni risposta servita. I dettagli — e perché
   l'opzione è spenta di default — sono nel [capitolo 27](27-topologia-proxy.md);
2. per le sessioni a cookie, le credenziali esplicite lato client — `credentials: 'include'`
   con `fetch`, `withCredentials: true` con XHR/HttpClient — e il login deve passare da
   Mockxy;
3. niente di particolare, invece, per l'autenticazione a token nell'header.

È la strada naturale quando non c'è un dev server con proxy (pagine statiche, strumenti
terzi, app mobile) o quando Mockxy è esposto in LAN per i colleghi. Client non-browser —
Postman, test, altri backend — non applicano il CORS: per loro basta il base URL, senza
alcuna configurazione.

## Verificare che tutto passi da Mockxy

Qualunque strada tu scelga, la prova del nove è il **monitor**: ogni chiamata
dell'applicazione deve comparirvi. Avvia l'app, naviga qualche schermata e apri la vista
Monitor — le richieste devono scorrere, tutte con provenienza «Backend vero» se non hai
ancora creato mock: significa che la catena funziona e Mockxy sta inoltrando tutto.

Se una chiamata **non compare** nel monitor, non sta passando da Mockxy: tipicamente un base
URL rimasto puntato al backend, o una regola di proxy che non copre quel prefisso. Il doppio
controllo è l'header `x-mock-source` sulla risposta (capitolo 2): se manca, la risposta non
è uscita da Mockxy.

> 📷 **SCREENSHOT** — `04-monitor-primo-traffico.png`
> Cosa mostrare: la vista Monitor con le prime richieste reali di un'applicazione in
> transito, tutte con provenienza «Backend vero» — la prova visiva che il collegamento
> funziona. Devono vedersi metodo, percorso, status e la colonna della provenienza.

Il collegamento c'è; prima di creare il primo mock, un giro completo dell'interfaccia per
sapere cosa c'è dove: [capitolo 5](05-tour-interfaccia.md).
