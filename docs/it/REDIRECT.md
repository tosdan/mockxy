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

## Dietro un reverse proxy

Se davanti a Mockxy c'è un reverse proxy (nginx, Traefik, un Ingress) che serve il sito in
https, il browser non parla con Mockxy: l'header `Host` può essere quello interno, e lo schema
`http` è sbagliato. Il redirect riscritto manderebbe il browser su `http://`, con un salto in più
nel caso migliore, la richiesta in chiaro o bloccata da HSTS nel peggiore.

Con **`TRUST_PROXY=true`** la riscrittura usa l'indirizzo pubblico, dagli header che il proxy
imposta:

- **`X-Forwarded-Proto`** per lo schema (`http` o `https`);
- **`X-Forwarded-Host`** per host e porta; se manca, resta l'header `Host` (nginx lo passa con
  `proxy_set_header Host $host`).

```
richiesta:  GET /login   Host: mockxy:3000
            X-Forwarded-Proto: https   X-Forwarded-Host: staging.app
backend:    Location: http://backend:8080/home
al client:  Location: https://staging.app/home
```

Con più proxy in catena vale il primo valore di ogni header, quello del proxy rivolto al
client. Un valore non valido (uno schema diverso da `http`/`https`, un host con percorso o
credenziali) viene ignorato, e si ricade su `http` e sull'header `Host`.

L'opzione è spenta di default: senza un proxy davanti quegli header li può mandare chiunque.
Il danno resterebbe confinato alla risposta di chi li manda, ma la fiducia va data solo a un
proxy che c'è davvero. Il quadro del deployment è in [DEPLOYMENT.md](DEPLOYMENT.md#dietro-un-reverse-proxy).
