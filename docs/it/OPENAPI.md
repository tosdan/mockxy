# L'import da OpenAPI

Se l'API ha una specifica, il workspace non si costruisce a mano: l'import genera **un mock per
ogni endpoint dichiarato**. L'obiettivo dichiarato è una **base solida da ritoccare** — mock
plausibili e subito funzionanti, non dati realistici: i valori che contano per il proprio flusso
si sistemano dopo, dal catalogo o a mano.

## Formati e interpretazione

Sono accettate specifiche **OpenAPI 3.0 / 3.1 e Swagger 2.0**, in **JSON o YAML**. Le versioni
più vecchie vengono convertite automaticamente alla struttura 3.1 e i riferimenti `$ref` sono
risolti, anche annidati o tra componenti: la specifica si passa così com'è.

## Cosa viene generato

Per ogni coppia percorso+metodo della specifica (metodi importati: `get`, `post`, `put`,
`delete`, `patch`):

- il **percorso** convertito nella [convenzione di Mockxy](PATH.md): `/users/{id}` →
  `/users/:id`;
- lo **status**: il primo `2xx` dichiarato tra le risposte;
- il **body**: dall'**esempio** della specifica quando c'è; altrimenti **campionato dallo
  schema** in modo deterministico (stessa specifica → stessi valori);
- la **collezione** nel catalogo: dai **tag** della specifica, riusando per nome le collezioni
  già presenti (il confronto ignora maiuscole e accenti, come la creazione manuale). Un tag
  chiamato come la collezione di default `Unsorted` non ne crea una: quei mock restano non
  assegnati. Un tag la cui collezione non si riesce a creare non blocca l'import: i suoi mock
  vengono creati comunque, senza collezione.

Gli endpoint **già esistenti** nel workspace (stessa coppia metodo+percorso) non vengono
toccati: l'import crea solo i nuovi. Rilanciare l'import dopo un aggiornamento della specifica
aggiunge ciò che manca senza sovrascrivere i ritocchi fatti nel frattempo.

## Anteprima

Dalla UI (barra superiore) l'import parte sempre con un'**anteprima**: il piano completo —
cosa verrebbe creato, cosa verrebbe saltato perché già esistente, con i conteggi — senza
scrivere nulla. Via API è `POST /_admin/api/mocks/import/openapi?dryRun=true`.

## Limiti e note

- Documento fino a **12 MB**.
- L'endpoint API richiede un **content-type esplicito** (`application/json`,
  `application/yaml` e varianti); `text/plain` è rifiutato con `415` di proposito — è la
  difesa anti-CSRF: una `POST text/plain` cross-origin partirebbe dal browser senza preflight.
- `head` e `options` della specifica non vengono importati, coerentemente con i metodi offerti
  dalla creazione mock.
