# Il CORS automatico

Il CORS entra in gioco in un solo scenario: un frontend **nel browser**, servito da un'origin
diversa, che chiama Mockxy **direttamente**. Per l'origin conta anche la porta, quindi il caso
tipico non è esotico: l'app su `localhost:4200` che punta a `http://localhost:3000` senza
configurare il proxy del dev server. L'altro caso è il server esposto in LAN, chiamato dai
browser dei colleghi.

Nel flusso consigliato il CORS non serve mai — ed è per questo che l'opzione è **spenta di
default**: se il frontend passa dal proxy del suo dev server il browser vede un'origin sola, e
i client non-browser (Postman, test, app mobile, altri backend) il CORS non sanno cosa sia.

Si attiva con `CORS_ENABLED=true` (headless) o con l'interruttore «CORS automatico» nelle
impostazioni del workspace (app desktop).

## Il principio: la policy è di Mockxy

Con l'opzione attiva, la policy CORS di **tutto ciò che esce da Mockxy è quella di Mockxy** —
mock, handler, errori locali e **anche le risposte proxate**. La policy del backend reale è
scritta per i browser che gli parlano direttamente: su uno staging condiviso può ammettere le
origin dei frontend deployati e non la tua; con Mockxy in mezzo è irrilevante, e viene
sovrascritta. Lo stesso vale per gli header CORS salvati *dentro* un mock — tipico dei mock
creati da una cattura, che ereditano la policy del backend originale.

Chi vuole osservare la policy CORS reale del backend attraverso il proxy, o gestire gli header
a mano nei mock, tiene semplicemente l'opzione spenta: allora Mockxy non tocca nulla, da
nessuna parte.

## I preflight

Prima di una richiesta cross-origin «non semplice» (un `POST` JSON, un header custom) il
browser manda un preflight: una `OPTIONS` con gli header `Origin` e
`Access-Control-Request-Method`. Con l'opzione attiva il motore risponde da sé, **prima di
qualunque inoltro al backend** — così la policy del preflight è sempre coerente con quella
delle risposte che seguiranno:

```
< HTTP/1.1 204 No Content
< x-mock-source: cors-preflight
< Access-Control-Allow-Origin: http://localhost:4200      ← eco dell'Origin richiesta
< Access-Control-Allow-Credentials: true
< Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS
< Access-Control-Allow-Headers: authorization, x-api-key  ← eco degli header richiesti
< Access-Control-Max-Age: 600
< Vary: Origin
```

Le regole di contorno:

- un mock o handler **`OPTIONS` esplicito** sulla rotta ha la precedenza: il gestore automatico
  si fa da parte;
- una `OPTIONS` **senza** `Access-Control-Request-Method` non è un preflight (è ad esempio una
  scoperta di capacità) e segue il flusso normale — mock, proxy o 404;
- i preflight automatici **non compaiono nel monitor**: sono infrastruttura del browser, non
  traffico API (ne arriverebbe uno per ogni scrittura cross-origin);
- il `Max-Age` di 10 minuti riduce i round-trip; va ricordato quando si *spegne* l'opzione: per
  qualche minuto il browser può ancora usare preflight in cache.

## Le risposte

Ogni risposta servita con un header `Origin` in richiesta esce con:

- **`Access-Control-Allow-Origin`** = l'origin della richiesta, riflessa (mai `*`: il wildcard
  viene rifiutato dal browser sulle richieste con credenziali, cioè con i cookie — e le
  sessioni attraverso il proxy sono un caso d'uso primario);
- **`Access-Control-Allow-Credentials: true`**;
- **`Vary: Origin`**, perché la risposta ora dipende dall'origin;
- **`Access-Control-Expose-Headers`** con almeno `X-Total-Count` (la
  [paginazione](LISTE.md)) e `x-mock-source` (la [provenienza](PROXY.md)), che altrimenti il
  JavaScript cross-origin non potrebbe leggere; eventuali header esposti dichiarati da mock o
  backend vengono **uniti**, non persi.

Su `Allow-Origin` e `Allow-Credentials` l'override del motore vince su qualunque valore
preesistente (mock catturati, risposte proxate); senza header `Origin` in richiesta — cioè per
tutto il traffico same-origin e non-browser — non viene toccato nulla.

## Il resto della storia

Il CORS dà il *permesso* di usare le credenziali; perché una sessione a cookie funzioni davvero
serve anche che i cookie sopravvivano al viaggio — è il compito dell'[adattamento dei cookie
proxati](COOKIE.md) — e che i redirect del backend non facciano evadere il browser da Mockxy —
è la [riscrittura dei redirect](REDIRECT.md). Le tre opzioni insieme coprono la topologia
«browser → Mockxy → backend reale».
