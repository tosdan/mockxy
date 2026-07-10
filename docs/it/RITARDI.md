# I ritardi simulati

In locale ogni risposta arriva in pochi millisecondi, e il frontend sembra sempre perfetto: gli
spinner non si vedono, le race condition non si manifestano, i timeout non scattano mai. I
ritardi simulati servono a riportare la latenza nel quadro — per vedere l'interfaccia come la
vedrà un utente su una rete vera.

## I tre livelli

1. **Per variante** — il campo `delayMs` nel [file di risposta](RESPONSE.md) di tipo `mock`:
   ritardo in millisecondi applicato prima di rispondere, proprio di quella variante. Utile per
   simulare il singolo endpoint lento (la ricerca pesante, l'export).
2. **Globale** — un ritardo applicato a **tutti i mock che non dichiarano un `delayMs` proprio**.
   Quando una variante ha un `delayMs` maggiore di zero, **vince sul globale**: i due non si
   sommano.
3. **Anche sul proxy** — di default il ritardo globale riguarda solo i mock; con l'opzione
   dedicata si estende alle **richieste proxate** verso il backend reale (incluso il
   passthrough «proxy all»). Il ritardo si somma al tempo reale del backend e viene applicato
   *prima* dell'inoltro: il timeout verso il backend non ne è consumato.

## Cosa non riceve ritardi

- **Le risposte degli handler**: uno script che vuole simulare lentezza può semplicemente
  attendere al proprio interno (`await` di un timer) — il motore non aggiunge nulla.
- Le risposte locali di servizio: il `404` in modalità solo-mock, il `501` senza backend
  configurato, i preflight CORS automatici.

## Dove si configura

- **App desktop**: impostazioni del workspace, voci «Ritardo globale (ms)» e «Ritardo anche sul
  proxy» (per-workspace, il motore riparte al cambio).
- **Riga di comando**: flag `--delay=<ms>` e `--delay-all`
  (`node index.js --delay=500 --delay-all`, oppure `npm run dev:backend -- --delay=500`).
- **Docker Compose**: variabili `MOCKXY_DELAY` e `MOCKXY_DELAY_ALL`, che il compose traduce nei
  flag di lancio — il motore da solo non le legge.

Il censimento completo, con i default, è in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).
