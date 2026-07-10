# La riscrittura dei redirect proxati

Terzo tassello della topologia «browser → Mockxy → backend reale», dopo il [CORS
automatico](CORS.md) e l'[adattamento dei cookie](COOKIE.md): i **redirect**. Un backend che
risponde a un login — o a uno slash finale mancante — con un `Location` assoluto verso il
*proprio* indirizzo (`Location: https://staging.example/home`) farebbe uscire il browser da
Mockxy: da quella navigazione in poi le richieste andrebbero dritte al backend, e proxy, cookie
adattati e policy CORS sparirebbero dal giro senza alcun segnale.

Per questo, **di default**, Mockxy riscrive i `Location` dei redirect proxati che puntano al
backend. L'opzione è `REWRITE_PROXY_REDIRECTS` (headless) o l'interruttore «Riscrivi i redirect
del proxy» nelle impostazioni del workspace.

## La regola

Su ogni risposta proxata con header `Location`:

- se il valore è un **URL assoluto la cui origin coincide con quella del backend configurato**
  (`BACKEND_URL`), schema, host e porta vengono sostituiti con **l'indirizzo con cui il client
  ha raggiunto Mockxy** (l'header `Host` della richiesta, schema `http`: Mockxy non fa TLS);
  percorso, query e fragment passano intatti:

  ```
  richiesta:  GET http://192.168.1.10:3000/login
  backend:    Location: https://staging.example/home?benvenuto=1
  al client:  Location: http://192.168.1.10:3000/home?benvenuto=1
  ```

- i **`Location` relativi** (`/home`) passano intatti: sono già corretti per definizione,
  perché il browser li risolve contro l'host con cui sta parlando;
- i redirect verso **host terzi** — l'SSO aziendale, un CDN, un provider di pagamento — passano
  intatti: riscriverli manderebbe il browser su un percorso che su Mockxy non esiste, rompendo
  flussi legittimi che *devono* uscire.

La riscrittura usa l'header `Host` della richiesta, quindi produce l'indirizzo giusto sia su
`localhost` sia via IP di LAN, senza configurazione. Se `BACKEND_URL` o l'header `Host` non
sono interpretabili, la riscrittura semplicemente non si attiva e tutto passa com'era.

Quando spegnerla: per osservare i redirect originali del backend attraverso il proxy — per
esempio quando si sta debuggando proprio la catena di redirect di staging.
