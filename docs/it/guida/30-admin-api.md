# 30 — L'admin API: automatizzare Mockxy

Tutta l'interfaccia di Mockxy è costruita su un'API REST sotto **`/_admin/api`**: non esiste
operazione della UI che non passi da lì. La conseguenza utile è che **tutto ciò che fa
l'interfaccia è automatizzabile** — e per uno sviluppatore frontend i casi d'uso sono
concreti: la suite e2e che prepara lo stato dei mock prima di ogni test, lo script che
popola un workspace da zero, la pipeline che reimporta la specifica a ogni aggiornamento del
contratto.

Questo capitolo insegna il modello e sviluppa tre esempi completi; il riferimento rotta per
rotta è in [ADMIN-API.md](../ADMIN-API.md).

## Il modello

- **Quando risponde**: attiva in sviluppo, spenta in produzione (`ADMIN_API_ENABLED`); da
  spenta, ogni rotta risponde 404. **Niente autenticazione** — le regole di esposizione e le
  protezioni (guardia sull'header `Host`, mutazioni solo JSON come difesa anti-CSRF) sono
  quelle del [capitolo 29](29-rete-sicurezza.md).
- **Le risorse** rispecchiano i concetti della guida: `/mocks` (endpoint e varianti, con
  selezione, sequenze e console SSE/WS), `/mocks/collections`, `/mocks/import/openapi`,
  `/files` (i file dati), `/monitoring` (monitor live e dump), `/server` (gli interruttori
  globali).
- **Effetto immediato**: le mutazioni sul catalogo ricaricano il runtime — la modifica è
  servita dalla richiesta successiva, senza riavvii.
- **Gli errori** sono JSON strutturati (`{ error, message, details? }`) con lo status
  appropriato.
- L'**`:id`** di un endpoint è un identificatore opaco che si ottiene dalle liste
  (`GET /mocks`): si legge e si ritrasmette, non si costruisce.

Un trucco pratico per scoprire i body giusti: l'interfaccia *è* un client di questa API —
qualunque operazione fatta dalla UI si osserva nei DevTools del browser, richiesta e body
inclusi, pronta da riprodurre in uno script.

## Esempio 1: script di setup

Creare un mock e sospendere i mock in blocco, da terminale:

```bash
BASE=http://localhost:3000/_admin/api

# crea un endpoint con la sua prima variante (mock statico)
curl -s -X POST "$BASE/mocks" \
  -H "content-type: application/json" \
  -d '{
    "config": { "method": "GET", "path": "/api/utenti/:id", "status": 200 },
    "body": { "id": 1, "nome": "Ada" },
    "description": "Creato da script"
  }'

# proxy totale: tutto al backend (l'interruttore della runtime bar, via API)
curl -s -X PATCH "$BASE/server" \
  -H "content-type: application/json" -d '{"proxyAll": true}'

# e il gemello: spegnere/riaccendere il server dei mock
curl -s -X PATCH "$BASE/server" \
  -H "content-type: application/json" -d '{"serverEnabled": true, "proxyAll": false}'
```

Nota il `content-type: application/json` esplicito su ogni mutazione: senza, la richiesta
viene rifiutata — è la difesa anti-CSRF.

## Esempio 2: il test e2e che prova il caso d'errore

Il caso d'uso più prezioso: un test Playwright che deve vedere il frontend reagire a un 500 —
impossibile da produrre a comando con un backend vero, banale selezionando la variante
d'errore prima del test:

```js
const BASE = "http://localhost:3000/_admin/api";

async function selectVariant(request, method, path, titleContains) {
  const { items } = await (await request.get(`${BASE}/mocks`)).json();
  const mock = items.find((m) => m.method === method && m.path === path);
  const detail = await (await request.get(`${BASE}/mocks/${mock.id}`)).json();
  const variant = detail.responses.find((r) => r.title?.includes(titleContains));
  await request.put(`${BASE}/mocks/${mock.id}`, {
    data: { selectedResponseFile: variant.fileName },
  });
}

test("mostra il banner d'errore quando la lista utenti fallisce", async ({ page, request }) => {
  await selectVariant(request, "GET", "/api/utenti", "500");
  await page.goto("/utenti");
  await expect(page.getByRole("alert")).toContainText("Riprova più tardi");
});

test.afterEach(async ({ request }) => {
  await selectVariant(request, "GET", "/api/utenti", "200");
});
```

Lo stesso schema copre il reset delle sequenze (`POST /mocks/:id/sequence/reset`) e la regia
SSE/WS dai test (`POST /mocks/:id/sse/push`, `POST /mocks/:id/ws/push`): il test spinge
l'evento e verifica la reazione della UI.

## Esempio 3: la pipeline che reimporta la specifica

L'import OpenAPI del [capitolo 23](23-import-openapi.md) è idempotente sugli esistenti,
quindi si presta a girare a ogni aggiornamento del contratto:

```bash
# prima l'anteprima: cosa verrebbe creato?
curl -s -X POST "$BASE/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

# poi l'import vero
curl -s -X POST "$BASE/mocks/import/openapi" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml
```

(Il content-type deve essere `application/yaml` o `application/json`; `text/plain` è
rifiutato con 415, di proposito.)

## Il perimetro delle altre superfici

Due cose che *non* passano dall'admin API, per non cercarle invano: le **impostazioni del
workspace** dell'app desktop (porta, backend, comportamento — viaggiano su un canale interno
dell'app, [capitolo 25](25-impostazioni-workspace.md)) e le **preferenze globali**
dell'applicazione. Via API si governa il motore: mock, monitor, dati, interruttori runtime.

Resta un'ultima configurazione da censire — quella del motore fuori dall'app desktop:
[variabili d'ambiente, Docker e immagine standalone](31-headless-docker.md).
