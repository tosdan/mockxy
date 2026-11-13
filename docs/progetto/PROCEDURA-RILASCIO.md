# Procedura di rilascio

Questa è la procedura operativa per creare una release stabile di Mockxy. La release nasce da un
tag Git `v<major>.<minor>.<patch>` e viene preparata automaticamente da GitHub Actions come bozza.
La pubblicazione della bozza resta sempre un'operazione manuale, successiva ai controlli sugli
artefatti.

## 1. Scegliere la versione

Applicare la **politica di versionamento di Mockxy**, centrata sulla compatibilità dei workspace:

- `patch` per correzioni compatibili, per esempio `1.3.1` → `1.3.2`;
- `minor` per nuove funzionalità e cambiamenti dell’admin API, anche non retrocompatibili,
  purché i workspace esistenti restino compatibili, per esempio `1.3.2` → `1.4.0`;
- `major` per incompatibilità dei workspace esistenti, per esempio `1.3.2` → `2.0.0`.

La compatibilità del workspace comprende il formato persistito e il significato delle definizioni:
leggere ancora gli stessi JSON non basta se occorre riscriverli o migrarli per conservare gli scenari
che descrivono. Le correzioni di bug e le modifiche documentate al ciclo di vita del runtime non
implicano automaticamente un nuovo formato o una major.

Una minor **non garantisce la retrocompatibilità dell’admin API**. Per ogni modifica incompatibile
aggiungere nelle note una sezione “Cambiamenti dell’admin API” con comportamento precedente,
nuovo comportamento e aggiornamento richiesto ai client. Aggiornare GUI e contratto insieme al
motore, coordinando anche guide e skill distribuiti separatamente. Gli agent, gli script e i test
sono client dell’API e non vanno considerati automaticamente allineati alla versione dell’app.

`/info` e `/openapi.yaml` sotto `/_admin/api` sono i riferimenti per versione e contratto; esistono
dalla 1.4.0, introdotti da S2 del [piano agent/API](PIANO-PILOTAGGIO-DA-AGENT.md). Un client non
deve presumere che una rotta descritta nel proprio skill sia già disponibile in un motore
precedente.

I cambiamenti che incidono sull’esposizione dell’admin, come il default di abilitazione introdotto
da S0, richiedono una nota esplicita e le istruzioni per mantenere il comportamento precedente,
indipendentemente dal numero di versione.

**Eccezione registrata: 1.6.0.** La 1.6.0 ritira l'import dalla radice dei mock introdotto nella
1.5.0 (`require("_shared/…")`), sostituito dall'alias `#shared/`. È un'incompatibilità per i
workspace che l'avevano adottato, e secondo la regola sopra chiederebbe una major. Il
proprietario ha scelto la minor perché la funzione è esistita solo nella 1.5.0, era difettosa
proprio nei casi d'uso reali, i workspace noti non l'avevano adottata e i percorsi relativi
restano supportati. La regola generale non cambia: l'eccezione vale per questa migrazione, è
dichiarata nelle note di rilascio con le istruzioni per gli import, e non va presa a precedente.

La versione deve essere stabile e composta soltanto da tre numeri. La pipeline non accetta
prerelease come `1.4.0-beta.1`.

## 2. Preparare il contenuto della release

La release passa da una pull request, come ogni altra modifica. Prima del bump:

1. verificare che tutte le modifiche destinate alla release siano già in `main`;
2. partire da `main` aggiornato e creare il branch della release:

   ```bash
   git checkout main
   git pull --ff-only
   git checkout -b release/1.3.2
   ```

3. scrivere le note dettagliate in [`NOTE-RILASCIO-next.md`](NOTE-RILASCIO-next.md), in una
   nuova sezione `## v1.3.2`, subito sotto `## Prossima versione`;
4. scrivere le note di pubblicazione in `NOTE-RILASCIO-v1.3.2.md`, in italiano e in inglese, con i
   link ai documenti alla tag (`blob/v1.3.2/...`), gli allegati attesi e il confronto con la
   release precedente;
5. verificare che non ci siano file estranei, credenziali, workspace reali o dati personali.

Le note sono sorgenti editoriali: la workflow genera una prima versione delle note GitHub, ma non
importa questi file nella release. Il testo di `NOTE-RILASCIO-v<versione>.md` si incolla a mano
nella bozza (§8). I link alla tag funzionano solo dopo il suo push (§6).

## 3. Aggiornare le versioni

Dalla root del repository eseguire uno dei comandi seguenti:

```powershell
npm run version:patch
npm run version:minor
npm run version:major
```

Lo script aggiorna la stessa versione nei sei file seguenti:

- `package.json` e `package-lock.json` della root;
- `mockxy-ui/package.json` e `mockxy-ui/package-lock.json`;
- `electron/package.json` e `electron/package-lock.json`.

Controllare il diff e verificare l'allineamento:

```powershell
git diff
npm run check:versions
```

È possibile verificare in anticipo anche la corrispondenza del futuro tag. Per esempio, dopo il
bump a `1.3.2`:

```powershell
npm run check:release-tag -- v1.3.2
```

## 4. Eseguire le verifiche locali

Il controllo locale minimo richiesto è:

```powershell
npm run check:versions
```

Prima di una release è raccomandato eseguire anche le suite disponibili:

```powershell
npm test
npm --prefix mockxy-ui test -- --watch=false
npm run test:e2e
```

La pipeline ripeterà comunque test del motore, test Electron, test UI ed E2E Chromium prima di
costruire gli artefatti.

## 5. Creare il commit e la pull request di release

Sul branch `release/1.3.2`, aggiungere esplicitamente i sei file di versione e le note, quindi
creare un commit dedicato:

```bash
git add package.json package-lock.json
git add mockxy-ui/package.json mockxy-ui/package-lock.json
git add electron/package.json electron/package-lock.json
git add docs/progetto/NOTE-RILASCIO-next.md docs/progetto/NOTE-RILASCIO-v1.3.2.md
git commit -m "release 1.3.2"
git push -u origin release/1.3.2
```

Aprire la pull request «Release 1.3.2» verso `main` e, a CI verde, unirla con **squash merge**.
Il commit di squash su `main` è il commit della release.

## 6. Creare e pubblicare il tag

Aggiornare `main` e controllare che l'ultimo commit sia lo squash della pull request di release:

```bash
git checkout main
git pull --ff-only
git log -1 --oneline        # release 1.3.2 (#N)
git status --short          # nessuna riga
```

Il tag va su quel commit e deve corrispondere esattamente alla versione presente nei package:

```bash
npm run check:release-tag -- v1.3.2
git tag v1.3.2
git push origin v1.3.2
```

`main` è già pubblicato dal merge: non serve, e non va fatto, un push diretto su `main`.

Non usare `git push --tags`: potrebbe pubblicare tag locali non destinati alla release.

## 7. Attendere la pipeline

Il push del tag avvia `.github/workflows/release.yml`. La workflow:

1. verifica che tag, versione root, versioni UI/Electron e lockfile coincidano;
2. esegue i test del motore e dei moduli Electron;
3. esegue i test UI e gli E2E Chromium;
4. costruisce la portable Windows x64;
5. costruisce l'AppImage Linux x64;
6. verifica i nomi degli artefatti e genera `SHA256SUMS.txt`;
7. crea una GitHub Release **in bozza** con note generate e allegati.

Gli allegati attesi sono:

- `Mockxy-<versione>-portable.exe`;
- `Mockxy-<versione>-x86_64.AppImage`;
- `SHA256SUMS.txt`.

La pipeline non rende mai pubblica la release.

## 8. Verificare e pubblicare la bozza

Prima di premere **Publish release**:

1. controllare che tutti i job obbligatori siano verdi;
2. scaricare il bundle `release-assets-v<versione>` dal run oppure gli allegati della bozza;
3. verificare i checksum;
4. provare la portable su Windows e l'AppImage su Linux;
5. verificare almeno apertura workspace, ripristino sessione e notifica aggiornamenti;
6. rivedere il titolo e incollare nella bozza il testo di `NOTE-RILASCIO-v<versione>.md`, al
   posto delle note generate o insieme a esse;
7. controllare che versione e nomi degli allegati siano corretti;
8. pubblicare manualmente la bozza dalla pagina GitHub.

Per verificare un checksum su Windows:

```powershell
Get-FileHash -Algorithm SHA256 .\Mockxy-1.3.2-portable.exe
```

Su Linux:

```bash
sha256sum -c SHA256SUMS.txt
```

Finché la release rimane in bozza, il controllo aggiornamenti del canale stabile non la propone
agli utenti.

## 9. Gestire errori o ritiri

- Se la pipeline fallisce per una causa transitoria, rilanciare il run.
- Se dopo la creazione del tag serve modificare codice o configurazione, non spostare e non
  riutilizzare il tag: correggere con una nuova versione patch e un nuovo tag.
- Se una bozza è incompleta, eliminarla senza eliminare il tag:

  ```powershell
  gh release delete v1.3.2 --yes
  ```

  Poi rilanciare l'intera workflow dalla pagina Actions. Non usare `--cleanup-tag`.
- Se una release già pubblicata è difettosa, riportarla immediatamente in bozza, senza sostituire
  gli artefatti. Preparare quindi una nuova patch.

## 10. Allineare le tag di skill e test di accettazione

Dopo la pubblicazione (§8), la stessa tag `v<versione>` va creata anche in
[mockxy-skills](https://github.com/tosdan/mockxy-skills) e in
[mockxy-acceptance-tests](https://github.com/tosdan/mockxy-acceptance-tests). I due repository non
hanno una numerazione propria: la tag dice quale stato corrisponde a quella release del motore.
Per le skill serve all'installazione per versione, che segue la tag invece di `main`:

```bash
npx skills@latest add https://github.com/tosdan/mockxy-skills/tree/v1.4.2
```

Il commit da taggare:

- **mockxy-skills:** l'ultimo commit di `main` le cui skill descrivono solo funzioni presenti nella
  release. Se `main` documenta già funzioni rimaste fuori, taggare il commit precedente a quelle
  modifiche.
- **mockxy-acceptance-tests:** il commit della suite risultata verde sul motore alla tag della
  release, o su un commit con lo stesso codice (va dichiarato nella checklist). La workflow
  `black-box.yml` accetta il ref del motore in `engine-ref`; se il dispatch non è disponibile, la
  verifica si fa in locale con `../mockxy` sulla tag.

Se un repository non è cambiato dalla release precedente, la nuova tag va sullo stesso commit
della precedente. Come per il motore, si usano tag semplici, si pubblica solo la singola tag e non
la si sposta: una correzione successiva entra nella release seguente.

```bash
git tag v1.4.2 <commit>
git push origin v1.4.2
```

Le prime tag allineate sono le `v1.4.2`, create dopo la release.

## Checklist rapida

- [ ] Funzionalità e correzioni committate.
- [ ] Documentazione aggiornata.
- [ ] Versioni incrementate con lo script npm.
- [ ] `check:versions` e `check:release-tag` superati.
- [ ] Test locali completati.
- [ ] Note dettagliate e note di pubblicazione `NOTE-RILASCIO-vx.y.z.md` scritte.
- [ ] Pull request «Release x.y.z» unita con squash merge.
- [ ] `main` locale aggiornato e working tree pulita.
- [ ] Tag `vx.y.z` creato sul commit di squash e pubblicato da solo.
- [ ] Pipeline completamente verde.
- [ ] Checksum e smoke test degli artefatti completati.
- [ ] Note della bozza riviste.
- [ ] Release pubblicata manualmente.
- [ ] Tag `vx.y.z` creata anche in mockxy-skills e mockxy-acceptance-tests.

