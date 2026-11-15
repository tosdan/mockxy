# Il proxy fallback

Il proxy fallback è ciò che rende Mockxy un **confine mobile tra mock e reale**: le richieste
che hanno un mock ricevono il mock, tutte le altre proseguono verso il backend vero. Il confine
si sposta un endpoint alla volta — aggiungendo un mock, disabilitandolo, o spegnendo il
fallback per lavorare in modalità solo-mock.

## La decisione, richiesta per richiesta

Il motore riserva a sé, senza distinguere maiuscole, `/_admin/api` con ogni metodo e, quando
serve l'interfaccia (app desktop, o headless con una build accanto al motore), `/_admin/ui` con `GET` e `HEAD`: lì risponde il motore stesso.
Tutte le altre richieste, compresi gli altri percorsi sotto `/_admin` e gli altri metodi su
`/_admin/ui`, seguono questi passi (per gli upgrade WebSocket vale [WEBSOCKET.md](WEBSOCKET.md)):

1. **Controlli globali.** Con il server dei mock **spento** o in modalità **proxy totale**
   (i due interruttori globali dell'interfaccia), nessun mock, handler o middleware interviene:
   tutto va dritto al backend. Senza un backend configurato, la risposta è `501 Backend Not
   Configured`.
2. **Preflight CORS.** Con l'opzione CORS attiva, i preflight `OPTIONS` del browser ricevono
   risposta automatica prima di qualunque inoltro (un mock `OPTIONS` esplicito ha la
   precedenza).
3. **Match di rotta.** La richiesta viene confrontata con le rotte registrate secondo
   [la convenzione dei path](PATH.md): se la rotta scelta definisce il metodo, risponde il mock
   o l'[handler](HANDLER.md) corrispondente (o il [middleware](MIDDLEWARE.md), che passa
   comunque dal backend).
4. **Nessun mock.** Per le richieste senza mock — rotta non trovata, o metodo non definito
   sulla rotta scelta — decide il **proxy fallback**:
   - **attivo** (default) e backend configurato → la richiesta viene inoltrata al backend;
   - **disattivo** → `404 Mock Not Found`, con nel body la ragione del mancato match
     (`path_not_mocked` o `method_not_mocked`) e la rotta eventualmente coinvolta;
   - attivo ma **senza backend configurato** → `501 Backend Not Configured`.

Il fallback si controlla con `PROXY_FALLBACK_ENABLED` (headless) o con l'interruttore «Proxy
fallback» nelle impostazioni del workspace (app desktop); il backend con `BACKEND_URL` o il
campo «Backend URL». Il censimento completo è in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

## Cosa viene inoltrato

L'URL verso il backend è la base configurata più percorso e query della richiesta. Dalla
richiesta si prendono **solo percorso e query**: schema, host e porta sono sempre quelli di
`BACKEND_URL`, comunque sia scritta la richiesta (`//altro-host/x`, `/\altro-host/x`,
`GET http://altro-host/x` restano percorsi del backend). Una richiesta non può quindi portare
altrove i cookie e l'`Authorization` che accompagna.

Se `BACKEND_URL` ha un **percorso**, quel percorso precede quello richiesto, come `proxy_pass`
di nginx con una URI:

```
BACKEND_URL=https://gateway.example/servizio/v1
richiesta:    GET /utenti?page=2
al backend:   GET https://gateway.example/servizio/v1/utenti?page=2
```

I mock restano sui percorsi che il client chiede a Mockxy (`/utenti`), e i segmenti `..` non
risalgono sopra il percorso di `BACKEND_URL`. Sulla via del ritorno il prefisso viene tolto dai
[redirect](REDIRECT.md#quando-backend_url-ha-un-percorso) e dal
[`Path` dei cookie](COOKIE.md#cosa-viene-adattato). Lo stesso vale per gli
[upgrade WebSocket](WEBSOCKET.md) inoltrati.

Gli header della richiesta passano tutti tranne quelli *hop-by-hop* (`Connection`,
`Transfer-Encoding` e simili, che appartengono alla singola tratta); `Host` viene riscritto a
quello del backend. Il body viaggia **in streaming**, senza buffering: upload grandi non
occupano memoria.

La risposta del backend torna al client con status e header originali (sempre meno gli
hop-by-hop), più gli header di no-cache. Tre opzioni — attive di default le prime due — adattano
la risposta alla topologia con Mockxy in mezzo: l'adattamento dei `Set-Cookie`
(`ADAPT_PROXY_COOKIES`), la riscrittura dei redirect verso il backend
(`REWRITE_PROXY_REDIRECTS`) e, quando abilitata, la policy CORS del motore (`CORS_ENABLED`).

## Backend in https

Con un `BACKEND_URL` in `https` il proxy verifica il certificato del backend, come fa un
browser. Si fida di:

- le autorità di certificazione che Node porta con sé;
- quelle dell'**archivio del sistema operativo** (Windows, macOS, i percorsi di OpenSSL su
  Linux): la CA aziendale installata sulla macchina, che il browser già accetta, vale anche
  per Mockxy senza configurare nulla. L'archivio viene letto all'avvio;
- quelle dei file indicati in **`NODE_EXTRA_CA_CERTS`** (un file PEM, variabile standard di
  Node): è la strada per un container, dove la CA non è nell'archivio di sistema.

  ```bash
  docker run -v ./ca-aziendale.pem:/certs/ca.pem:ro -e NODE_EXTRA_CA_CERTS=/certs/ca.pem …
  ```

Un certificato che nessuna di queste conosce — tipicamente quello **autofirmato** di un backend
locale — viene rifiutato, e la risposta è un `502` che lo dice (vedi sotto). Per un backend di
cui ci si fida comunque la verifica si spegne: `VERIFY_BACKEND_CERTIFICATE=false` (headless) o
l'interruttore «Verifica il certificato del backend» nelle impostazioni del workspace. Da
spenta il proxy accetta **qualunque** certificato, anche scaduto o emesso per un altro nome:
all'avvio il motore lo segnala nel log. Vale anche per gli [upgrade WebSocket](WEBSOCKET.md)
inoltrati. È un'impostazione di avvio: non si cambia a runtime dall'admin API.

## Errori e timeout

- **Backend irraggiungibile** (connessione rifiutata, DNS fallito) → `502 Bad Gateway`.
- **Certificato del backend non verificato** → `502 Bad Gateway`, con un corpo che nomina il
  problema invece della rete: `details.code` vale `BACKEND_CERTIFICATE_NOT_VERIFIED` e
  `details.reason` il codice di Node (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` per una CA
  sconosciuta, `DEPTH_ZERO_SELF_SIGNED_CERT` per un autofirmato, `CERT_HAS_EXPIRED`,
  `ERR_TLS_CERT_ALTNAME_INVALID` per un nome che non corrisponde). Nel log la riga ha
  `errorType: certificate_not_verified`. Rimedi in [Backend in https](#backend-in-https).
- **Timeout** (`requestTimeoutMs`): copre connessione, invio della richiesta e attesa dei
  **primi header di risposta**. Superato, la risposta è ancora `502`. Una volta che la risposta
  è iniziata, il timeout **non si applica più**: uno stream può tacere per minuti o durare ore
  senza essere troncato — un upstream morto a metà si manifesta come errore di connessione.
- **Errore a risposta già iniziata**: con gli header ormai inviati non c'è più uno status da
  cambiare; la connessione viene chiusa in modo *sporco*, così il client percepisce il
  troncamento invece di scambiarlo per una risposta completa.
- **Client che abbandona**: la tratta verso il backend viene chiusa subito, senza sprecare
  lavoro upstream.

## Da dove è arrivata la risposta: `x-mock-source`

Ogni risposta porta l'header tecnico **`x-mock-source`**, che è anche la voce «provenienza» nel
monitor — il primo strumento di diagnosi quando una richiesta non fa ciò che ci si aspetta:

| Valore | Significato |
|---|---|
| `mock` | risposta statica di un mock |
| `handler` | generata da un handler locale |
| `middleware` | risposta del backend trasformata da un middleware |
| `backend` | proxata al backend senza trasformazioni (incluso il bypass dei middleware su stream e risposte oltre soglia) |
| `mock-only` | `404` con proxy fallback disattivo |
| `backend-unconfigured` | `501` per assenza di backend configurato |
| `cors-preflight` | preflight `OPTIONS` gestito dal CORS automatico |
