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

## Preparazione di una release

Fino all'introduzione della workflow di release descritta nel piano operativo:

1. verificare che la working tree sia pulita;
2. eseguire `npm run check:versions`;
3. eseguire le suite di test e le build previste;
4. aggiornare versione e note di rilascio;
5. creare un tag `v<versione>` coerente con i package;
6. pubblicare gli artefatti nella release dello stesso tag;
7. verificare dalla pagina pubblica che note e download siano accessibili senza login.

Quando la workflow automatica sarà disponibile, questa sezione dovrà essere sostituita con la
procedura effettiva e con le istruzioni di rollback.
