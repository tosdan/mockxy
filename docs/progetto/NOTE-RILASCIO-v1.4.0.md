# Mockxy 1.4.0

## Italiano

Mockxy 1.4.0 permette ad agent, script e test di preparare scenari tramite API,
verificare il traffico prodotto e lavorare con la GUI aperta. I workspace esistenti
restano compatibili: non è necessaria una migrazione.

### Novità

- **Scenari preparabili via API:** lettura delle varianti per nome file e creazione
  con `select: false`, senza cambiare la risposta attiva. Guide e un esempio
  Playwright mostrano un setup ripetibile che dichiara le condizioni del test.
- **Modifiche affidabili:** le mutazioni dello stesso workspace sono serializzate,
  il loro effetto è verificato sul runtime e gli errori distinguono rifiuto,
  applicazione fallita e ripristino fallito. I batch riportano gli esiti per elemento,
  compreso ciò che è rimasto scritto dopo un errore parziale.
- **Bozze protette e GUI sincronizzata:** revisioni del contenuto impediscono
  sovrascritture inconsapevoli. La GUI segue le modifiche esterne senza perdere le
  bozze, segnala i conflitti e gli errori di caricamento, recupera dalle letture
  fallite e scarta risposte obsolete al cambio di workspace.
- **Identità e contratto del server:** `/info`, `/runtime/status`, `/config` e
  `/openapi.yaml`, sotto `/_admin/api`, espongono istanza, workspace, diagnostica,
  configurazione effettiva e specifica della versione in esecuzione.
- **Monitor per test e agent:** paginazione, filtri, sommari, lettura per ID e
  cursori permettono di osservare il traffico successivo a un'azione. `gap: true`
  segnala riavvii, svuotamenti o espulsione delle voci.
- **Mock dal traffico:** Monitor e Storico usano la stessa trasformazione nel
  server, con scelte esplicite sull'attivazione e avvisi per catture incomplete.
- **Stream SSE/WebSocket preservati:** una ricarica chiude solo gli stream degli
  endpoint il cui comportamento cambia, o che vengono disabilitati o eliminati.
- **Configurazione temporanea:** `PATCH /config` cambia nove impostazioni fino al
  riavvio, senza salvarle su disco. Il pannello «Configurazione» mostra valori
  effettivi, valori di avvio e override, e permette di rimuoverli. Le impostazioni
  desktop restano distinte. I limiti del dump sono leggibili e modificabili via API.

### Cambiamenti dell'admin API e aggiornamento

- **Admin attiva per default in sviluppo:** senza `ADMIN_API_ENABLED`, l'API ora è
  attiva in sviluppo e spenta con `NODE_ENV=production`. Su un bind di rete, incluso
  il Docker di sviluppo avviato senza Compose, può diventare raggiungibile dalle
  porte pubblicate. Per mantenerla spenta impostare `ADMIN_API_ENABLED=false`;
  per Docker locale pubblicare su loopback (`-p 127.0.0.1:3000:3000`). Desktop,
  Compose e immagine standalone hanno già una scelta esplicita.
- **Namespace riservato:** le rotte sconosciute sotto `/_admin/api` rispondono `404`,
  anche per WebSocket; non raggiungono mock o backend.
- **Errori più precisi:** gli errori di scrittura o reload possono rispondere `500`
  invece di `400`. Un file ancora mancante durante la lettura del dettaglio dà
  `409 READ_INCONSISTENT`; un salvataggio con revisione superata dà
  `409 REVISION_CONFLICT`. Leggere `details.code` e gli esiti dei batch anche con `201`.
- **Monitor:** la lista senza query e lo stream SSE mantengono il contratto
  precedente. Parametri sconosciuti o parametri senza `view=page` ora danno `400`.
- **Altri adeguamenti:** lo spec canonico è in `src/admin/admin-api.openapi.yaml`;
  le console SSE/WS seguono la definizione servita; i body JSON `null` vengono
  conservati; i limiti del dump inviati via API vengono validati. Per ricominciare
  un copione SSE/WS invariato occorre riaprire la connessione.

L'admin API evolve insieme all'app. Aggiornare gli skill di
[mockxy-skills](https://github.com/tosdan/mockxy-skills) e consultare versione e
contratto dal runtime. Gli override non vengono ripristinati al riavvio.

[Dettagli completi e migrazione dei client](https://github.com/tosdan/mockxy/blob/v1.4.0/docs/progetto/NOTE-RILASCIO-next.md#v140)
· [Guida admin API](https://github.com/tosdan/mockxy/blob/v1.4.0/docs/it/ADMIN-API.md)

## English

Mockxy 1.4.0 lets agents, scripts and tests prepare scenarios through the API,
inspect the resulting traffic and work alongside the GUI. Existing workspaces
remain compatible; no migration is required.

### What's new

- **API scenario setup:** read variants by filename and create them with
  `select: false`, without changing the active response. Guides and a Playwright
  example demonstrate repeatable setup with explicit test conditions.
- **Reliable mutations:** workspace mutations are serialized and their effects
  checked against the runtime. Errors distinguish rejection, failed application
  and failed rollback. Batches report each item's outcome, including partial writes.
- **Protected drafts and live GUI updates:** content revisions prevent accidental
  overwrites. External changes do not replace drafts; the GUI reports conflicts
  and load errors, retries failed reads and discards stale workspace responses.
- **Runtime discovery:** `/info`, `/runtime/status`, `/config` and `/openapi.yaml`
  under `/_admin/api` expose instance and workspace identity, diagnostics,
  effective configuration and the running version's API contract.
- **Queryable Monitor:** pagination, filters, summaries, ID lookup and cursors
  let tests inspect traffic following an action. `gap: true` reports restarts,
  clearing or eviction of entries.
- **Mocks from traffic:** Monitor and History share a server-side transformation,
  with explicit activation options and warnings for incomplete captures.
- **Preserved SSE/WebSocket streams:** reloads close only streams whose endpoint
  behavior changes, or whose endpoint is disabled or deleted.
- **Temporary configuration:** `PATCH /config` changes nine settings until restart,
  without persisting them. The Configuration panel displays effective and startup
  values and allows overrides to be removed. Desktop startup settings remain
  separate. Dump size limits can also be read and changed through the API.

### Admin API changes and upgrading

- **Admin enabled by default in development:** when `ADMIN_API_ENABLED` is absent,
  the API is now enabled in development and disabled with `NODE_ENV=production`.
  A network bind, including the development Docker image run without Compose, can
  expose it through published ports. Set `ADMIN_API_ENABLED=false` to keep it off;
  for local Docker use a loopback binding (`-p 127.0.0.1:3000:3000`). Desktop,
  Compose and the standalone image already set the flag explicitly.
- **Reserved namespace:** unknown routes under `/_admin/api` return `404`, including
  WebSocket upgrades, without reaching mocks or the backend.
- **More precise errors:** write or reload failures can return `500` instead of
  `400`. Persistently missing detail files return `409 READ_INCONSISTENT`; a stale
  revision on a protected write returns `409 REVISION_CONFLICT`. Inspect
  `details.code` and per-item batch outcomes even on `201` responses.
- **Monitor:** the unparameterized list and SSE stream retain their previous
  contract. Unknown query parameters, or parameters without `view=page`, now return `400`.
- **Other adjustments:** the canonical spec moved to `src/admin/admin-api.openapi.yaml`;
  SSE/WS consoles target the installed runtime definition; JSON `null` bodies are
  preserved; supplied dump limits are validated. Reconnect explicitly to restart
  an unchanged SSE/WS script.

The admin API evolves with the app. Update
[mockxy-skills](https://github.com/tosdan/mockxy-skills) and read version and contract
from the runtime. Configuration overrides do not survive a restart.

[Full API guide](https://github.com/tosdan/mockxy/blob/v1.4.0/docs/en/ADMIN-API.md)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.4.0/docs/progetto/NOTE-RILASCIO-next.md#v140)

## Download

- **Windows x64:** `Mockxy-1.4.0-portable.exe`
- **Linux x64:** `Mockxy-1.4.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.3.2...v1.4.0)
