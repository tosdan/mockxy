# Note di rilascio — prossima versione

Documento provvisorio per la prossima release; il numero di versione verrà assegnato durante la
procedura di pubblicazione.

## Stato runtime condiviso degli handler

- Gli handler ricevono `sharedState`, uno store JSON effimero condiviso per nome fra endpoint.
  `open(name, { seedKey, initialize })` restituisce un handle con `read()`, `mutate()` e
  `replace()`; consente scenari come POST → GET senza modificare i file del workspace.
- Lo stato sopravvive al reload a caldo ma non a riavvio o cambio workspace. Quote predefinite:
  256 risorse, 3 MiB per risorsa, 25 MiB complessivi e profondità JSON 100.
- La pagina Dati include il tab **Stato runtime** con metadati e reset singolo/globale. Il
  Monitor conserva i metadati diagnostici degli errori e offre il collegamento alla risorsa,
  senza esporre valori nel body pubblico.
- Le risposte handler possono attivare filtri e paginazione delle liste con
  `applyListQuery: true`.
- L'anteprima della copia endpoint (`POST /mocks/:id/copy?dryRun=true`) mostra file, asset e
  riferimenti letterali allo stato condiviso che la copia continuerà a usare.

## Admin API: cambiamento incompatibile circoscritto

Le quattro POST amministrative senza parametri richiedono ora sempre
`Content-Type: application/json` e un body reale esattamente uguale a `{}`:

- `POST /mocks/:id/sequence/reset`;
- `POST /monitoring/dump/flush`;
- `POST /runtime/shared-state/:name/reset`;
- `POST /runtime/shared-state/reset`.

Per le prime due rotte, già pubbliche, un client che prima inviava zero byte deve essere
aggiornato. Esempio:

```bash
curl -X POST http://localhost:3000/_admin/api/monitoring/dump/flush \
  -H 'content-type: application/json' \
  -d '{}'
```

Body assente/vuoto, `null`, array, scalari e oggetti non vuoti rispondono `400`; media type
diversi rispondono `415`.
