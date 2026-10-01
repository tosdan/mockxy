# Verifica del rilascio 1.4.2

Verifiche del 1 ottobre 2026. Il commit di release è
`e56b88ee3bbc2fb76fafc8415b27b2d87c747688`, pubblicato su `main` e con il tag
`v1.4.2`. Il tag e gli artefatti non vengono modificati da questo documento.

## Preparazione e test

- Root, GUI ed Electron sono allineati alla 1.4.2 nei sei file di versione.
  `check:versions`, `check:release-tag -- v1.4.2`, `check:admin-openapi` e
  `git diff --check` sono passati.
- Motore e moduli Electron: 92 suite, **1.091 test passati**.
- GUI: 41 file, **526 test passati**. Il primo giro con parallelismo predefinito
  aveva nove timeout, con load average circa 57. La suite completa è stata
  rieseguita con un worker Vitest, usando una configurazione temporanea esterna
  al repository, e due worker di build. Timeout e test non sono stati modificati.
- E2E Chromium, con build desktop: **119 test passati senza retry**.
- La suite di accettazione è sul commit
  `bc941948b3b6888d25c2092320cc2ddc44f80a85`, con checklist chiusa.

## Pipeline e artefatti

- [Pipeline del tag](https://github.com/tosdan/mockxy/actions/runs/36848175852):
  tutti i cinque job passati, inclusi test, portable Windows x64, AppImage Linux
  x64 e creazione della bozza.
- [CI ordinaria](https://github.com/tosdan/mockxy/actions/runs/36848172024) e
  [accettazione esterna](https://github.com/tosdan/mockxy/actions/runs/36848171988)
  passate sullo stesso commit di release.
- Il bundle `release-assets-v1.4.2` contiene
  `Mockxy-1.4.2-portable.exe`, `Mockxy-1.4.2-x86_64.AppImage` e `SHA256SUMS.txt`.
  Entrambi i checksum sono verificati. L'AppImage collaudato è identico a quello
  del bundle finale.

## Collaudo Linux

GUI e motore inclusi nell'AppImage scaricato sono stati eseguiti su display
virtuale, con workspace e preferenze temporanei. Per il controllo Electron
automatizzato è stato usato l'eseguibile estratto dall'AppImage.

- App e `/info` riportano **1.4.2**.
- Il workspace di prova si apre e viene ripristinato alla riapertura dell'app.
- Gli hash delle definizioni originali restano invariati.
- Lo spec servito dichiara interi gli identificativi delle connessioni SSE/WS.
- Una risposta di un backend locale viene catturata con `x-mock-source: backend`;
  il mock creato non salva quell'header.
- Il controllo aggiornamenti reale restituisce `up-to-date`, versione corrente
  1.4.2 e ultima pubblica 1.4.1, con canale `appimage`. È atteso finché la 1.4.2
  resta in bozza.

Il display virtuale non sostituisce la prova nativa della portable Windows.

## Passaggio alla pubblicazione

- [x] Note curate in italiano e inglese inserite nella
  [bozza della 1.4.2](https://github.com/tosdan/mockxy/releases/tag/untagged-0dc1b990d877735fcc91),
  mantenuta in bozza.
- [x] Test, pipeline e checksum completati.
- [x] Collaudo di GUI e motore del pacchetto Linux completato.
- [ ] Provare la portable su Windows: apertura workspace, ripristino della
  sessione e controllo aggiornamenti.
- [ ] Pubblicare manualmente la bozza dopo i controlli, come richiede il §8 di
  [PROCEDURA-RILASCIO.md](PROCEDURA-RILASCIO.md).

Le [note per la pubblicazione](NOTE-RILASCIO-v1.4.2.md) sono già nella bozza.
