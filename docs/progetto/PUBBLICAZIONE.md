# Stato della pubblicazione del repository

Stato aggiornato al 29 luglio 2026.

`https://github.com/tosdan/mockxy` è il repository pubblico definitivo del progetto. Non
esiste più un passaggio futuro verso un secondo repository pubblico: codice, issue, tag,
release e manifest degli aggiornamenti desktop fanno riferimento a questo repository.

La vecchia checklist che descriveva l'esportazione verso un repository nuovo è stata
completata e superata dagli eventi. Non deve essere usata come procedura di rilascio.

## Riferimenti canonici

- repository: `https://github.com/tosdan/mockxy`;
- issue: `https://github.com/tosdan/mockxy/issues`;
- release: `https://github.com/tosdan/mockxy/releases`;
- convenzione dei tag stabili: `v<major>.<minor>.<patch>`;
- piano per release e distribuzioni desktop:
  [PIANO-DISTRIBUZIONE-DESKTOP.md](PIANO-DISTRIBUZIONE-DESKTOP.md).

I `package.json` di root, UI ed Electron devono dichiarare questi stessi riferimenti. La CI
verifica inoltre che le versioni dei tre package e dei rispettivi lockfile siano allineate.

## Regole permanenti per un repository pubblico

- Non aggiungere `.env`, credenziali, certificati, stato di autenticazione o workspace reali.
- Non copiare indiscriminatamente una working directory dentro il repository.
- Prima di versionare nuove fixture o workspace demo, controllare dati personali e segreti.
- Un segreto pubblicato va ruotato: rimuoverlo da un commit successivo non lo rende nuovamente
  sicuro.
- Conservare token e credenziali delle release esclusivamente nei secret della CI.
- Non includere token GitHub negli artefatti desktop: le release pubbliche sono leggibili
  senza autenticazione.
- Rieseguire periodicamente audit delle dipendenze e scansioni dei contenuti; la verifica
  eseguita prima della prima pubblicazione non copre modifiche future.

## Suite di accettazione

La suite black-box vive in `tosdan/mockxy-acceptance-tests` ed è richiamata dalla workflow
`.github/workflows/acceptance.yml`. Se quel repository è privato, il secret
`ACCEPTANCE_REPO_TOKEN` deve avere soltanto il permesso di lettura dei contenuti. Se diventa
pubblico, la workflow può usare il token GitHub predefinito.

Fixture, credenziali e dati della suite di accettazione seguono le stesse regole di audit del
repository principale.

## Preparazione di una release desktop

La workflow `.github/workflows/release.yml` parte esclusivamente dal push di un tag
`v<major>.<minor>.<patch>`. Prima di creare qualsiasi release:

1. aggiornare la versione con `npm run version:patch`, `version:minor` o `version:major`;
2. completare note e documentazione della release;
3. committare tutte le modifiche e verificare che la working tree sia pulita;
4. eseguire localmente almeno `npm run check:versions`;
5. creare il tag corrispondente alla versione, per esempio `git tag v1.2.0`;
6. pubblicare prima il commit e poi il tag: `git push origin main` e
   `git push origin v1.2.0`.

La workflow rifiuta tag non stabili, tag diversi dalla versione dei package o versioni
disallineate tra root, UI ed Electron. Poi esegue:

- test del motore e dei moduli Electron;
- test UI ed E2E Chromium;
- build x64 della portable Windows e dell'AppImage Linux, senza pubblicazione automatica di
  `electron-builder`;
- verifica dei due nomi artefatto e generazione di `SHA256SUMS.txt`;
- creazione di una **GitHub Release in bozza** con note generate, artefatti e checksum.

I job di test e build hanno soltanto `contents: read`. Solo il job finale riceve
temporaneamente `contents: write` tramite il `GITHUB_TOKEN` del run; non servono token di
release permanenti e nessun token entra negli artefatti.

## Verifica e pubblicazione della bozza

La workflow non rende mai pubblica una release. Prima di premere **Publish release**:

1. controllare che tutti i job obbligatori siano verdi;
2. scaricare il bundle `release-assets-v<versione>` dal run oppure i file dalla bozza;
3. verificare i checksum (`sha256sum -c SHA256SUMS.txt` su Linux; su Windows confrontare
   `Get-FileHash -Algorithm SHA256 <file>` con la riga corrispondente);
4. provare la portable su Windows e l'AppImage su Linux, inclusi apertura workspace,
   ripristino sessione e notifica aggiornamenti;
5. rivedere titolo e note generate;
6. pubblicare manualmente la bozza dalla pagina GitHub.

Finché resta bozza, la release non viene proposta dal checker stable dell'app.

## Fallimento, annullamento e ritiro

- Se un job fallisce **prima** della creazione della bozza per una causa transitoria,
  rilanciare il run. Se invece serve modificare codice o configurazione, non spostare il tag:
  correggere su una nuova versione patch e creare un nuovo tag coerente.
- Se il caricamento lascia una bozza incompleta, eliminarla mantenendo il tag con
  `gh release delete v<versione> --yes`, quindi rilanciare l'intera workflow dalla pagina
  Actions. Non usare `--cleanup-tag`.
- Non pubblicare una bozza che non supera smoke test e checksum.
- Se una release già pubblicata è difettosa, ritirarla subito dalla visibilità pubblica
  riportandola in bozza, non sovrascrivere gli artefatti e non riutilizzare la versione.
  Correggere il problema con una nuova versione patch e un nuovo tag.
