# Mockxy in uno staging condiviso

Lo scenario: un ambiente di staging interno, usato da tutto il team e dal QA, con il suo frontend
deployato. Il frontend è spesso più avanti del backend: le chiamate che il backend implementa già
vanno al backend vero, le altre ricevono un mock. Man mano che il backend rilascia, il confine si
sposta verso il reale (lo scenario «[il backend non c'è
ancora](SCENARI.md#il-backend-non-cè-ancora-e-il-confine-si-sposta)», condiviso da molte persone).

Lo staging è un ambiente **congelato**: tutti ricevono il comportamento scritto in git, e Mockxy
riempie i buchi senza diventare un banco di lavoro. I mock si scrivono e si provano in locale,
con l'[app desktop](DESKTOP.md); nello staging arrivano con una PR.

## Il profilo

Non serve un'immagine nuova: è l'[immagine standalone](DEPLOYMENT.md#immagine-standalone) con il
proxy fallback acceso. Il compose d'esempio è `docker-compose.staging-proxy.yml`:

| | Valore | Perché |
|---|---|---|
| Proxy fallback | acceso, `BACKEND_URL` obbligatorio | dove manca il mock risponde il backend |
| `TRUST_PROXY` | `true` | davanti c'è un reverse proxy (sotto) |
| Admin API e interfaccia | spente | nessuna superficie da proteggere |
| Watch dei mock | spento | i mock cambiano solo con un aggiornamento |
| Porta | solo sul loopback dell'host | la raggiunge il reverse proxy, non la rete |

**Perché l'admin è spenta.** L'admin API non ha autenticazione e può creare handler, cioè
eseguire JavaScript sul server. Spenta, non c'è niente da proteggere; in cambio mancano
interfaccia, Monitor e Storico, e il traffico si legge dai [log](#leggere-il-traffico). Restano
attivi solo l'[health](ADMIN-API.md#health) e la risposta `404` sul resto di `/_admin/api`.

**Un'istanza, un backend.** Ogni staging ha il suo container, con un solo `BACKEND_URL`. Se lo
staging espone più servizi, li smista il reverse proxy; se servono mock su più servizi, si usa
un'istanza di Mockxy per servizio. Niente repliche dietro un load balancer: sequenze e stato
degli handler vivono nella memoria del processo.

## La topologia

```text
browser ──https──► reverse proxy ──► /       frontend deployato (file statici)
                                └──► /api/   Mockxy ──► mock, oppure backend di staging
```

Frontend e API hanno la stessa origine: il [CORS](CORS.md) non serve. Un esempio con nginx:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name staging.example.internal;
    ssl_certificate     /etc/nginx/certs/staging.crt;
    ssl_certificate_key /etc/nginx/certs/staging.key;
    root /srv/frontend;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        # Solo se il frontend usa WebSocket sotto /api.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

- **`TRUST_PROXY`.** Con gli header `X-Forwarded-*` i [redirect](REDIRECT.md) e i
  [cookie](COOKIE.md) del backend escono con l'indirizzo pubblico in https: il perché di
  `$http_host` è in [DEPLOYMENT.md](DEPLOYMENT.md#dietro-un-reverse-proxy).
- **I percorsi non cambiano.** `proxy_pass` senza percorso lascia `/api/...` com'è, e Mockxy lo
  inoltra così al backend: i mock si dichiarano con gli stessi percorsi del backend.
- **Header tecnici per il backend.** Se il backend vuole un header di ambiente o un token
  tecnico, lo aggiunge il reverse proxy (`proxy_set_header X-Env staging;`): Mockxy lo inoltra
  intatto.

## Avvio

Dal checkout di Mockxy, dove c'è il compose:

```bash
export BACKEND_URL=http://backend-staging:8080
export MOCKXY_WORKSPACE=/srv/mockxy-mocks          # checkout del repository dei mock
MOCKS_VERSION=$(git -C "$MOCKXY_WORKSPACE" rev-parse --short HEAD) \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

| Variabile | Default | |
|---|---|---|
| `BACKEND_URL` | nessuno | obbligatoria: senza, il compose si ferma con un messaggio |
| `MOCKXY_WORKSPACE` | `./workspace` | cartella con `mocks/` e `files/`, montate in sola lettura |
| `MOCKS_VERSION` | vuota | la versione dei mock, mostrata dall'health e nel log di avvio |
| `MOCKXY_HOST_PORT` | `3000` | porta sul loopback dell'host |

`--wait` aspetta che l'health risponda `200`, di solito in pochi secondi. Con un file rotto il
comando fallisce dopo circa un minuto (i tempi del `healthcheck`) e il container resta
`unhealthy`.

**Backend in https con una CA interna.** Node non conosce la CA aziendale: si monta il
certificato e lo si indica con `NODE_EXTRA_CA_CERTS`, la variabile standard di Node. Le due righe
sono già nel compose, commentate:

```yaml
    environment:
      - NODE_EXTRA_CA_CERTS=/certs/ca.pem
    volumes:
      - ./certs/ca.pem:/certs/ca.pem:ro
```

## Aggiornare i mock

Dopo il merge di una modifica ai mock: arresto, pull, avvio.

```bash
docker compose -f docker-compose.staging-proxy.yml stop
git -C "$MOCKXY_WORKSPACE" pull
MOCKS_VERSION=$(git -C "$MOCKXY_WORKSPACE" rev-parse --short HEAD) \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

- **Prima l'arresto.** I file dati e le risposte da file si leggono a ogni richiesta: a motore
  acceso, durante il pull convivrebbero definizioni vecchie e dati nuovi. Qualche secondo di
  fermo è meglio di risposte incoerenti.
- **Il riavvio azzera lo stato.** Sequenze, memoria e stato condiviso degli handler ripartono da
  capo a ogni aggiornamento.
- **Un file rotto non ferma il motore.** L'endpoint del file rotto non viene registrato e le sue
  richieste **vanno al backend**, che spesso risponde `404` o qualcosa di inatteso. L'health lo
  segnala (`503`, `status: "degraded"`, con il percorso del file); il messaggio d'errore è nel
  log di avvio (`docker compose -f docker-compose.staging-proxy.yml logs mockxy`). Si corregge
  con una nuova PR, o si torna alla versione precedente.

```bash
curl -s http://127.0.0.1:3000/_admin/api/health
```

L'health risponde sulla porta di Mockxy, non attraverso il reverse proxy, che manda a Mockxy
solo `/api/`.

### Variante: una cartella per versione

Per un fermo più breve e un ritorno immediato alla versione precedente, ogni versione dei mock
ha la sua cartella e un collegamento `current` punta a quella in uso. La cartella servita non
cambia mai sotto il motore.

```bash
MOCKS=/srv/mockxy-mocks                     # contiene repo/, releases/ e current
git -C "$MOCKS/repo" fetch
SHA=$(git -C "$MOCKS/repo" rev-parse --short origin/main)
git -C "$MOCKS/repo" worktree add --detach "$MOCKS/releases/$SHA" "$SHA"
ln -sfn "releases/$SHA" "$MOCKS/current"
MOCKXY_WORKSPACE="$MOCKS/current" MOCKS_VERSION=$SHA \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

Per tornare indietro si sposta `current` sulla cartella precedente e si rilancia `up` con il suo
`MOCKS_VERSION`. Sempre `up`, non `restart`: il riavvio seguirebbe il collegamento, ma l'health
e i log riporterebbero ancora la versione vecchia.

## Leggere il traffico

Con l'admin spenta il traffico si legge dai log JSON del container. Ogni richiesta chiude con una
riga «Request completed» che dice chi ha risposto (`mode`: `mock`, `handler`, `backend`, …) e,
per i mock, quale endpoint e quale variante ([il dettaglio](DEPLOYMENT.md#aggiornare-e-controllare)).
Per esempio, le richieste servite dai mock nell'ultima ora, con [jq](https://jqlang.org/):

```bash
docker compose -f docker-compose.staging-proxy.yml logs --since 1h --no-log-prefix mockxy \
  | jq -c 'select(.msg == "Request completed." and .mode != "backend")'
```

Anche dal browser si capisce chi ha risposto: ogni risposta porta l'header
[`x-mock-source`](PROXY.md#da-dove-è-arrivata-la-risposta-x-mock-source).

## Scrivere i mock per lo staging

Lo staging serve a tutti lo stesso comportamento. Qualche regola per i mock che ci arrivano:

- **La variante selezionata è quella di tutti.** In git va selezionato il caso normale. Errori,
  liste vuote e casi limite si provano in locale con l'app desktop.
- **Sequenze con `resetAfterMs`, o niente.** Il cursore di una [sequenza](RESPONSE.md#risposta-sequence)
  è unico per endpoint: le richieste di persone diverse lo consumano a vicenda. Con
  `resetAfterMs` riparte dopo una pausa; altrimenti meglio una variante semplice.
- **Lo stato condiviso degli handler è il database dello staging.** Un elemento creato da una
  persona compare a tutti, e tutto riparte dal file seed a ogni aggiornamento
  ([stato runtime condiviso](HANDLER.md#stato-runtime-condiviso)).
- **Gli stessi percorsi del backend.** Un mock risponde al posto del backend, sullo stesso
  percorso: quando il backend arriva, basta spegnere il mock.

## Spostare il confine

Quando il backend rilascia un endpoint nello staging, una PR sul repository dei mock lo
**disabilita** (`"enabled": false` nel [file endpoint](ENDPOINT.md#i-campi)) o lo rimuove; dopo
il merge si [aggiorna](#aggiornare-i-mock) lo staging. Da quel momento le richieste vanno al
backend, e `x-mock-source` lo conferma.

Mockxy non lo fa da solo: un mock dimenticato continua a rispondere anche quando il backend è
pronto, e nasconde il comportamento reale nei test end-to-end. Conviene legare il passo al
processo del backend, per esempio con una voce nella sua checklist di rilascio: «c'è un mock
per questo endpoint? PR che lo disabilita».

## Cosa non c'è

Scelte fatte per tenere lo staging semplice, da riprendere su una domanda concreta: un'interfaccia
di sola consultazione (catalogo, Monitor e Storico senza azioni), scenari o varianti per singola
persona, il ritorno automatico al mock quando il backend non implementa un endpoint, più backend
per istanza, header aggiunti dal motore verso il backend e mTLS.
