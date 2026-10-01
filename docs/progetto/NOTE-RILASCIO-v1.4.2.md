# Mockxy 1.4.2

## Italiano

La 1.4.2 corregge il contratto OpenAPI e la creazione di mock dalle catture.
I workspace esistenti restano compatibili: non è necessaria una migrazione.

- **Identificativi SSE/WebSocket:** lo spec dichiara interi gli identificativi delle
  connessioni e i relativi `connectionId` nello storico SSE e nel transcript WS,
  come il motore ha sempre restituito. Le risposte non cambiano; l'`id` degli eventi
  SSE resta una stringa.
- **Mock dalle catture:** la creazione dal Monitor e dallo Storico esclude
  `x-mock-source` dagli header salvati. Il valore viene impostato dal motore quando
  serve la risposta; prima il file poteva contenere il fuorviante valore `backend`.
- **Descrizioni OpenAPI:** quattro descrizioni troncate da virgole nelle mappe YAML
  sono complete. Il controllo dello spec rileva questo errore preservando i dati
  validi degli esempi e dei valori predefiniti.

Le correzioni sono emerse dalla suite di accettazione esterna. Gli skill di
[mockxy-skills](https://github.com/tosdan/mockxy-skills) sono stati allineati alla
regola sugli header delle catture.

[Guida admin API](https://github.com/tosdan/mockxy/blob/v1.4.2/docs/it/ADMIN-API.md)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.4.2/docs/progetto/NOTE-RILASCIO-next.md#v142)

## English

Version 1.4.2 fixes the OpenAPI contract and mock creation from captured traffic.
Existing workspaces remain compatible; no migration is required.

- **SSE/WebSocket identifiers:** the spec declares connection identifiers and
  their `connectionId` fields in SSE history and WS transcripts as integers,
  matching the values the engine has always returned. Responses do not change;
  SSE event `id` remains a string.
- **Mocks from captures:** creation from Monitor and History excludes
  `x-mock-source` from stored headers. The engine sets it when serving the
  response; previously the file could contain the misleading value `backend`.
- **OpenAPI descriptions:** four descriptions truncated by commas in YAML maps
  are complete. Spec validation detects this error while preserving valid
  example and default data.

These fixes were identified by the external acceptance suite. The
[mockxy-skills](https://github.com/tosdan/mockxy-skills) instructions have been
aligned with the capture header rule.

[Admin API guide](https://github.com/tosdan/mockxy/blob/v1.4.2/docs/en/ADMIN-API.md)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.4.2/docs/progetto/NOTE-RILASCIO-next.md#v142)

## Download

- **Windows x64:** `Mockxy-1.4.2-portable.exe`
- **Linux x64:** `Mockxy-1.4.2-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.4.1...v1.4.2)
