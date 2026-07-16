# WebSocket e richieste di upgrade

Le WebSocket sono un altro protocollo: negoziate con una richiesta HTTP di *upgrade*, poi
frame bidirezionali che non hanno nulla della coppia richiesta/risposta. Mockxy le tratta in
due modi complementari:

- **mock locale** — un endpoint la cui variante selezionata è di tipo [`ws`](RESPONSE.md)
  gestisce l'handshake localmente: copione di messaggi, regole di risposta e console con regia
  manuale, senza backend;
- **passthrough verso il backend reale** — tutto il resto: il caso d'uso è l'app che mocka le
  API HTTP ma tiene una connessione live verso il backend per notifiche o aggiornamenti — e
  non deve trovarsela rotta.

All'upgrade il motore consulta il registry dei mock (a server attivo e fuori da Proxy All):
se l'endpoint matcha una variante `ws` la connessione è servita dal mock, altrimenti vale il
tunnel descritto sotto. Il resto di questa pagina documenta il **passthrough**.

## Come funziona

Le richieste di upgrade non attraversano la pipeline HTTP: niente mock, handler, middleware,
[adattamenti di topologia](CORS.md) né monitor. Il motore le gestisce su un binario dedicato:

1. **l'handshake viene inoltrato al backend** così com'è (header ricreati correttamente per la
   nuova tratta, `Host` riscritto), protetto dal timeout di richiesta;
2. se il backend accetta (`101 Switching Protocols`), i due socket vengono **incollati**: byte
   in una direzione, byte nell'altra, con chiusura incrociata — e **senza timeout di
   inattività**, perché una WebSocket può legittimamente tacere a lungo. Il tunnel, stabilito,
   è agnostico rispetto al protocollo;
3. se il backend **rifiuta** l'handshake (es. `401` per autenticazione mancante), la sua
   risposta viene inoltrata onestamente al client, così l'errore è diagnosticabile.

Allo spegnimento del server i tunnel attivi vengono chiusi esplicitamente: una WebSocket aperta
non tiene mai in ostaggio lo shutdown.

## Quando l'upgrade viene rifiutato localmente

Tre casi ricevono una risposta HTTP di rifiuto senza contattare nessuno:

- **backend non configurato** → `501`: gli upgrade esistono solo come inoltro, senza
  `BACKEND_URL` non c'è dove inoltrare;
- **proxy fallback disattivo** (in modalità mock) → `404`: la modalità solo-mock vale anche per
  gli upgrade;
- **percorsi `/_admin/...`** → `404`: l'admin API non ha endpoint di upgrade.

In modalità *proxy totale* gli upgrade vengono sempre inoltrati, coerentemente con il resto del
traffico.
