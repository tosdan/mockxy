# Il proxy fallback

Il proxy fallback è ciò che rende Mockxy un **confine mobile tra mock e reale**: le richieste
che hanno un mock ricevono il mock, tutte le altre proseguono verso il backend vero. Il confine
si sposta un endpoint alla volta — aggiungendo un mock, disabilitandolo, o spegnendo il
fallback per lavorare in modalità solo-mock.

## La decisione, richiesta per richiesta

Per ogni richiesta in arrivo (esclusi i percorsi riservati `/_admin/...`):

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

L'URL verso il backend è la base configurata più percorso e query della richiesta, così come
sono. Gli header della richiesta passano tutti tranne quelli *hop-by-hop* (`Connection`,
`Transfer-Encoding` e simili, che appartengono alla singola tratta); `Host` viene riscritto a
quello del backend. Il body viaggia **in streaming**, senza buffering: upload grandi non
occupano memoria.

La risposta del backend torna al client con status e header originali (sempre meno gli
hop-by-hop), più gli header di no-cache. Tre opzioni — attive di default le prime due — adattano
la risposta alla topologia con Mockxy in mezzo: l'adattamento dei `Set-Cookie`
(`ADAPT_PROXY_COOKIES`), la riscrittura dei redirect verso il backend
(`REWRITE_PROXY_REDIRECTS`) e, quando abilitata, la policy CORS del motore (`CORS_ENABLED`).

## Errori e timeout

- **Backend irraggiungibile** (connessione rifiutata, DNS fallito) → `502 Bad Gateway`.
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
