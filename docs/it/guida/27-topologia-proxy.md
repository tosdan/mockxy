# 27 — Browser, cookie, CORS e redirect: la topologia del proxy

Nelle impostazioni del workspace vivono tre interruttori — **CORS automatico**, **Adatta i
cookie del proxy**, **Riscrivi i redirect del proxy** — che a prima vista sembrano dettagli
oscuri. Sono invece le risposte ai tre problemi che nascono, matematicamente, quando tra un
browser e un backend si mette un proxy. Questo capitolo li racconta problema per problema:
capito il problema, l'interruttore si spiega da sé.

La premessa: un backend è scritto per i browser che gli parlano **direttamente**. La sua
policy CORS elenca le origin dei suoi frontend; i suoi cookie sono legati al suo dominio; i
suoi redirect puntano al suo indirizzo. Con Mockxy in mezzo, il browser parla con **l'host di
Mockxy, tipicamente su http** — e ognuna di quelle tre assunzioni si rompe in un modo
specifico.

## CORS automatico: il permesso di parlare

Il CORS entra in gioco in un solo scenario: un frontend nel browser, servito da **un'altra
origin**, che chiama Mockxy **direttamente** — il caso della «strada B» del
[capitolo 4](04-collegare-frontend.md), tipicamente `localhost:4200` → `localhost:3000` (per
l'origin conta anche la porta), o il server esposto in LAN chiamato dai browser dei colleghi.
Nel flusso consigliato — il proxy del dev server — il CORS non serve mai: per questo
l'opzione è **spenta di default**.

Da attiva, il principio è netto: **la policy CORS di tutto ciò che esce da Mockxy è quella di
Mockxy** — mock, handler, errori locali e anche le risposte proxate. La policy del backend
(che magari ammette le origin dei frontend deployati, non la tua) viene sovrascritta; e lo
stesso vale per gli header CORS salvati *dentro* i mock catturati, che ereditano la policy
del backend originale. In concreto:

- i **preflight** `OPTIONS` ricevono risposta automatica dal motore, prima di qualunque
  inoltro (un mock `OPTIONS` esplicito ha la precedenza; i preflight non compaiono nel
  monitor — sono infrastruttura del browser, non traffico API);
- ogni risposta a una richiesta con `Origin` esce con l'**origin riflessa** (mai `*`, che il
  browser rifiuta sulle richieste con credenziali), `Allow-Credentials: true`, e
  l'esposizione di `X-Total-Count` e `x-mock-source` al JavaScript cross-origin;
- il traffico same-origin e non-browser non viene toccato.

Quando spegnerlo (oltre al default): per osservare la policy CORS *reale* del backend
attraverso il proxy, o per gestire gli header CORS a mano nei mock.

## Adattare i cookie: il login che «non tiene»

Il sintomo è tra i più frustranti perché **silenzioso**: il login sembra riuscire, ma la
sessione non si stabilisce mai — nessun errore, solo richieste che tornano 401. La causa: lo
staging risponde al login con un `Set-Cookie` pensato per sé — legato al suo dominio
(`Domain=staging.example`), vincolato a https (`Secure`), marcato per i flussi cross-site
(`SameSite=None`). Per il browser quel cookie arriva **dall'host di Mockxy, su http**: ognuno
di quei tre attributi lo fa scartare in silenzio.

Per questo, di default, Mockxy **adatta** i `Set-Cookie` inoltrati dal proxy: rimuove
`Domain` (il cookie diventa host-only sull'host di Mockxy, dove il browser lo rimanderà),
`Secure` e `SameSite=None` (che senza Secure sarebbe rifiutato; si ricade sul default `Lax`).
**Nome e valore non vengono mai toccati**, gli altri attributi passano intatti, e i mock non
c'entrano: l'adattamento riguarda solo le risposte proxate.

La sessione attraverso Mockxy funziona quindi così: il **login passa da Mockxy** (un cookie
ottenuto visitando lo staging direttamente non verrà mai spedito a Mockxy — per il browser i
cookie appartengono all'host con cui parla); il `Set-Cookie` adattato si registra come cookie
dell'host di Mockxy; da lì in poi il browser lo allega e il proxy lo inoltra. Nella topologia
cross-origin servono anche il CORS automatico e le credenziali esplicite lato frontend
(`credentials: 'include'` / `withCredentials: true`).

Un limite che nessun adattamento supera: tra **site diversi su http** (il frontend di un
collega che chiama Mockxy sul tuo IP di LAN) le regole `SameSite` del browser impediscono
l'invio dei cookie, e l'alternativa richiederebbe https. Lì l'autenticazione a cookie è
impraticabile — quella **a token nell'header** funziona perfettamente.

Quando spegnerlo: per osservare i `Set-Cookie` originali del backend — ad esempio mentre si
debugga proprio la gestione dei cookie di staging.

## Riscrivere i redirect: il browser che «scappa»

Terzo problema, anch'esso silenzioso: il backend risponde al login — o a uno slash finale
mancante — con un redirect **assoluto verso il proprio indirizzo**
(`Location: https://staging.example/home`). Il browser obbedisce, e da quella navigazione in
poi parla **direttamente con il backend**: Mockxy, i mock, i cookie adattati e la policy CORS
sono spariti dal giro, senza alcun segnale. I sintomi tipici: il monitor che smette di
registrare a metà flusso, mock che «funzionavano un attimo fa».

Per questo, di default, Mockxy **riscrive** i `Location` dei redirect proxati che puntano
all'origin del backend configurato: schema, host e porta diventano quelli con cui il client
ha raggiunto Mockxy, mentre percorso, query e fragment passano intatti:

```
richiesta:  GET http://192.168.1.10:3000/login
backend:    Location: https://staging.example/home?benvenuto=1
al client:  Location: http://192.168.1.10:3000/home?benvenuto=1
```

I `Location` **relativi** (`/home`) passano intatti — sono già corretti per definizione — e i
redirect verso **host terzi** (l'SSO aziendale, un provider di pagamento) pure: quelli
*devono* uscire da Mockxy, e riscriverli romperebbe flussi legittimi.

Quando spegnerla: per osservare la catena di redirect originale del backend.

## Il filo conduttore: un login completo

I tre interruttori insieme, nella storia in cui servono tutti: frontend cross-origin che
chiama Mockxy direttamente, staging come backend. L'utente preme «Accedi»: il preflight del
`POST /login` riceve risposta dal **CORS automatico**; il `POST` attraversa il proxy e lo
staging risponde con il `Set-Cookie` di sessione, che l'**adattamento cookie** rende
accettabile per il browser; la stessa risposta è un redirect verso
`https://staging.example/home`, che la **riscrittura dei redirect** riporta sull'indirizzo di
Mockxy. Il browser naviga, la sessione tiene, e tutto il traffico successivo continua a
passare da Mockxy — osservabile nel monitor, mockabile un endpoint alla volta.

> 📷 **SCREENSHOT** — `27-tre-interruttori.png`
> Cosa mostrare: la sezione Comportamento della dialog impostazioni con i tre interruttori
> (CORS automatico, Adatta i cookie, Riscrivi i redirect) e i rispettivi hint visibili.

> 📷 **SCREENSHOT** — `27-setcookie-adattato.png`
> Cosa mostrare: i DevTools del browser su una risposta di login passata da Mockxy, con il
> `Set-Cookie` adattato visibile (senza Domain/Secure); in alternativa, il confronto della
> stessa risposta con adattamento spento.

La topologia locale è sistemata; il passo successivo è quando Mockxy smette di essere solo
locale — l'esposizione in rete, con ciò che comporta:
[capitolo 29](29-rete-sicurezza.md), passando prima dal
[multi-workspace desktop](28-desktop-workspace.md).
