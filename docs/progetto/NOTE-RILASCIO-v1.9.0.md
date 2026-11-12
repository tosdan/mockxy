# Mockxy 1.9.0

## Italiano

La 1.9.0 porta Mockxy in uno staging condiviso: i mock dove il backend non arriva ancora, il
backend vero altrove, dietro un reverse proxy in https e con l'admin spenta. Riguarda
l'esecuzione headless e Docker: **l'interfaccia e l'app desktop non cambiano**, e **nessun
intervento sui workspace**. L'admin API non cambia; l'health è una rotta nuova sotto il suo
prefisso.

- **Staging condiviso:**
  - **Guida:** profilo, topologia con nginx, avvio, aggiornamento dei mock, lettura del traffico,
    regole per i mock condivisi e spostamento del confine tra mock e backend.
  - **Compose:** `docker-compose.staging-proxy.yml`, l'immagine standalone con il proxy fallback
    acceso, `BACKEND_URL` obbligatorio e un `healthcheck`.
- **Dietro un reverse proxy:** con `TRUST_PROXY=true` Mockxy legge `X-Forwarded-Proto` e
  `X-Forwarded-Host`. I redirect riscritti puntano all'indirizzo pubblico in https, e i cookie
  adattati su https conservano `Secure` e `SameSite=None`. Spenta di default.
- **Health:** `GET /_admin/api/health` risponde anche con l'admin spenta. `200` se il workspace si
  è caricato senza errori, `503` con i percorsi dei file rotti; riporta la versione del motore e
  quella dei mock.
- **Versione dei mock:** `MOCKS_VERSION`, di solito il commit del workspace, compare nell'health e
  nel log di avvio.
- **Log delle richieste:** la riga «Request completed» dice quale endpoint e quale variante hanno
  risposto, e il passo di una sequenza.
- **Aggiornare i mock dell'immagine standalone** richiede un riavvio del container: la
  documentazione ora dice arresto, `git pull`, avvio.
- **Skill:** le skill alla tag `v1.9.0` sono le stesse della 1.8.0.

[Staging condiviso](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/it/STAGING.md)
· [Deployment](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/it/DEPLOYMENT.md)
· [Health](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/it/ADMIN-API.md#health)
· [Configurazioni](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/it/CONFIGURAZIONI.md)
· [Note dettagliate](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/progetto/NOTE-RILASCIO-next.md#v190)

## English

Version 1.9.0 brings Mockxy to a shared staging: mocks where the backend is not there yet, the
real backend elsewhere, behind an https reverse proxy and with the admin API off. It is about
headless and Docker use: **the interface and the desktop app do not change**, and **workspaces
need no change**. The admin API does not change; the health check is a new route under its
prefix.

- **Shared staging:**
  - **Guide:** the profile, the topology with nginx, starting, updating the mocks, reading the
    traffic, rules for mocks shared by many people, and moving the boundary between mocks and
    backend.
  - **Compose:** `docker-compose.staging-proxy.yml`, the standalone image with the proxy fallback
    on, a required `BACKEND_URL` and a `healthcheck`.
- **Behind a reverse proxy:** with `TRUST_PROXY=true` Mockxy reads `X-Forwarded-Proto` and
  `X-Forwarded-Host`. Rewritten redirects point to the public https address, and adapted cookies
  over https keep `Secure` and `SameSite=None`. Off by default.
- **Health check:** `GET /_admin/api/health` answers with the admin API off too. `200` when the
  workspace loaded with no errors, `503` with the paths of the broken files; it reports the engine
  version and the mocks version.
- **Mocks version:** `MOCKS_VERSION`, typically the workspace commit, appears in the health check
  and in the startup log.
- **Request log:** the «Request completed» line tells which endpoint and which variant answered,
  and the step of a sequence.
- **Updating the mocks of the standalone image** needs a container restart: the documentation now
  says stop, `git pull`, start.
- **Skills:** the skills at tag `v1.9.0` are the same as in 1.8.0.

[Shared staging](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/en/STAGING.md)
· [Deployment](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/en/DEPLOYMENT.md)
· [Health check](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/en/ADMIN-API.md#health)
· [Configuration](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/en/CONFIGURAZIONI.md)
· [Detailed release notes (Italian)](https://github.com/tosdan/mockxy/blob/v1.9.0/docs/progetto/NOTE-RILASCIO-next.md#v190)

## Download

- **Windows x64:** `Mockxy-1.9.0-portable.exe`
- **Linux x64:** `Mockxy-1.9.0-x86_64.AppImage`
- **SHA-256:** `SHA256SUMS.txt`

[All changes / Tutte le modifiche](https://github.com/tosdan/mockxy/compare/v1.8.0...v1.9.0)
