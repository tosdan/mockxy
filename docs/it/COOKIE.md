# L'adattamento dei cookie proxati

Quando il browser parla con Mockxy e il login avviene attraverso il [proxy
fallback](PROXY.md), i cookie di sessione del backend reale devono sopravvivere a un viaggio
per cui non sono stati scritti. Un `Set-Cookie` emesso da uno staging è pensato per i browser
che parlano con lo staging *direttamente*: è legato al suo dominio (`Domain`), spesso vincolato
a https (`Secure`) e ai flussi cross-site (`SameSite=None`). Per il browser, però, quel cookie
arriva **dall'host di Mockxy, su http**: quegli attributi lo farebbero scartare in silenzio, e
la sessione non si stabilirebbe mai — il classico login che «non tiene» senza alcun errore
visibile.

Per questo, **di default**, Mockxy adatta i `Set-Cookie` inoltrati dal proxy. L'opzione è
`ADAPT_PROXY_COOKIES` (headless) o l'interruttore «Adatta i cookie del proxy» nelle
impostazioni del workspace.

## Cosa viene adattato

Da ogni `Set-Cookie` in transito dal backend vengono rimossi tre attributi:

- **`Domain`** — il cookie diventa *host-only* sull'host di Mockxy, che è dove il browser lo
  rimanderà. Con il `Domain` del backend verrebbe rifiutato subito;
- **`Secure`** — su http via IP (tipico dell'uso in LAN) un cookie `Secure` viene scartato;
- **`SameSite=None`** — senza `Secure` è a sua volta rifiutato; rimosso, il cookie ricade sul
  default `Lax`, adeguato ai flussi same-site di sviluppo.

**Nome e valore del cookie non vengono mai toccati**, e gli altri attributi (`Path`,
`HttpOnly`, `Expires`, `Max-Age`, gli altri valori di `SameSite`) passano intatti. Il parsing è
tollerante con i formati sciatti visti in natura (maiuscole, spazi attorno all'uguale). I mock
non c'entrano: l'adattamento riguarda solo le risposte proxate.

Quando spegnerlo: per osservare i `Set-Cookie` originali del backend attraverso il proxy, o nel
caso raro di cookie condivisi tra più sottodomini raggiunti attraverso un alias DNS che punta a
Mockxy.

## Come funziona una sessione attraverso Mockxy

1. Il login **deve passare da Mockxy**: per il browser i cookie appartengono all'host con cui
   parla, quindi un cookie ottenuto visitando lo staging direttamente non verrà mai spedito a
   Mockxy.
2. Lo staging risponde al login con il `Set-Cookie`; Mockxy lo adatta e il browser lo registra
   come cookie **dell'host di Mockxy**.
3. Da lì in poi il browser lo allega alle richieste verso Mockxy, e il proxy lo inoltra allo
   staging: la sessione funziona.

Perché il browser *alleghi* i cookie a chiamate cross-origin servono anche il [CORS
automatico](CORS.md) attivo e, lato frontend, `credentials: 'include'` (fetch) o
`withCredentials: true` (XHR/HttpClient).

## I limiti che nessun adattamento può superare

Le regole `SameSite` ragionano per *site* (dominio registrabile), non per origin — e la porta
non conta né per il site né per l'ambito dei cookie. Ne discendono i due scenari:

- **stesso site** (es. frontend su `localhost:4200` e Mockxy su `localhost:3000`): nessun
  ostacolo; su `localhost`, peraltro, i browser trattano http come contesto sicuro;
- **site diversi su http** (es. frontend servito dal `localhost` di un collega che chiama
  Mockxy sul tuo IP di LAN): `SameSite=Lax` impedisce l'invio dei cookie sulle fetch, e
  l'alternativa `SameSite=None` richiederebbe `Secure`, cioè https, che Mockxy non offre.
  L'autenticazione a cookie lì è impraticabile — quella **a token nell'header
  `Authorization`** funziona perfettamente, e il preflight CORS a eco la copre già.

Nota: il monitor maschera il valore di `Set-Cookie` come gli altri header sensibili — nelle
catture non finiscono i token di sessione.
