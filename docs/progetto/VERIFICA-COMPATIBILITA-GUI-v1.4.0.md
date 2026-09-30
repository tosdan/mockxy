# Verifica della compatibilità GUI — Mockxy 1.4.0

Obiettivo: verificare che le modifiche della release non abbiano compromesso
l’integrazione fra GUI e motore. Base di confronto: `v1.3.2`. Release verificata:
`v1.4.0`, commit `2f44dc14ee437bba05d78f56ef39e6c3ec25dfc4`.

## Esito

I flussi ordinari e i contratti API usati dalla GUI risultano compatibili. È stata
però trovata una regressione nel recupero del dettaglio dopo una creazione o una
copia riuscita. Nella creazione con body da file, lo stesso percorso può anche
scrivere il file sull’endpoint precedente. La correzione è nella
[PR #40](https://github.com/tosdan/mockxy/pull/40), integrata su `main` con
lo squash `8e79502` e inclusa nella preparazione della 1.4.1;
non fa parte dell’AppImage o della portable già costruite per il tag 1.4.0.

## Evidenze sulla release originale

- Audit del servizio `MockAdminApiService` e dei chiamanti: rotte, forma dei risultati,
  default di creazione, aggiornamenti parziali, precondizioni, upload, console,
  codici `400`/`409`/`500`, risultati parziali dei batch e configurazione runtime.
- Suite sul commit di release: 1.086 test motore/Electron, 511 test GUI e 117 test
  Playwright. La GUI passa con due worker e timeout invariati; la prima esecuzione
  ad alta concorrenza aveva dato nove timeout. Playwright passa senza ritentativi.
- Pipeline del tag: tutti i job verdi, incluse suite GUI/E2E e build Windows/Linux.
  Anche CI ordinaria e black-box sono verdi.
- AppImage originale: checksum verificato, apertura della fixture immutata della
  1.3.2, ripristino della sessione, GUI e OpenAPI inclusi nel pacchetto, identità e
  configurazione runtime, controllo aggiornamenti reale e definizioni non riscritte.
- Collaudo aggiuntivo: **106 test GUI contro il motore e la GUI dell’AppImage
  distribuita**, senza ritentativi, tutti passati. Una configurazione temporanea
  disabilita gli avvii dei server sorgente; il motore viene avviato dall’AppImage su
  una copia del workspace di fixture. Sono esclusi solo gli 11 test di setup per
  agent, che usano un secondo server e sono già coperti dal collaudo della release.
  Inclusi CRUD, descrizioni, varianti, selezioni, collection, drag/drop, import,
  Dati, Monitor, Storico, sequence, SSE/WS, bozze, sincronizzazione e configurazione.

Pipeline: https://github.com/tosdan/mockxy/actions/runs/36644660853

## Regressione e correzione

Il server può completare una mutazione e rispondere con
`{ id, detailUnavailable: { message } }`: è il ramo C1 in cui manca soltanto la
lettura del dettaglio successiva alla scrittura. `applyMutationDetail` memorizzava
il messaggio ma perdeva l’id. Dopo aver creato B mentre A era aperto, «Rileggi»
richiedeva A; senza selezione precedente non richiedeva nulla. Anche una rilettura
automatica poteva recuperare A e far sparire l’avviso relativo a B.

La correzione conserva l’id come bersaglio di recupero e selezione del catalogo.
«Rileggi», ricarica manuale e sincronizzazione leggono B. Un dettaglio completo
azzera il bersaglio pendente; selezionare un altro endpoint lo sostituisce. Il
cambio di workspace blocca le riletture automatiche dell’omonimo del precedente,
anche quando B è il primo endpoint e non esiste ancora un dettaglio selezionato.
Non si modifica né si ripete la creazione già riuscita.

La review di Opus ha individuato il caso aggiuntivo della creazione con body da
file: il dialog creava B e poi l’upload ricavava il bersaglio da `selected()`, ancora
A. Con A aperto, ne sovrascriveva la variante; senza selezione, non partiva e il
dialog restava aperto. La creazione ora passa al callback l’id restituito dal
server, e il dialog usa quel bersaglio esplicito con la prima variante già
dichiarata nella richiesta di creazione. Riusa il percorso di upload con bersaglio
fisso e senza precondizione, senza dipendere dal dettaglio o dalla selezione.

Tre regressioni dialog–store falliscono prima della correzione: upload su A,
nessun upload alla prima creazione e upload fallito sul bersaglio sbagliato. Un
quarto test verifica che il cambio di workspace impedisca l’upload successivo a
una creazione tardiva. Il collaudo browser sul pacchetto originale fallisce
confermando l’id di A nella richiesta di upload. Sul codice corretto verifica il
file effettivamente servito da B e sia il token sia il contenuto di A invariati.

Le due regressioni iniziali falliscono sulla GUI della 1.4.0: GET per A al posto
di B e nessuna GET alla prima creazione. Con la correzione passano. Le ulteriori
prove coprono copia, ricarica, sincronizzazione, riapertura del precedente e cambio
workspace. Un collaudo Playwright crea realmente B e simula soltanto la risposta
C1 senza dettaglio, per verificare l’intero percorso di recupero nell’interfaccia.

La stessa prova fallisce contro la GUI e il motore dell’AppImage originale:
«Rileggi» torna al dettaglio A. Sul branch corretto passano **526 test GUI**
(15 nuovi test), **1.086 test motore/Electron** e **119 test Playwright**
senza ritentativi (due nuove regressioni nell’interfaccia). Il collaudo Playwright
esegue anche la build di produzione. La review finale del diff non ha ulteriori
rilievi sul contratto o sulle regole del repository.

## Limiti e rilascio

La prova Windows dell’artefatto resta manuale. Il collaudo Linux usa un display
virtuale; non sostituisce una prova delle integrazioni native su Windows.

La review di Opus sul commit `3c2264c` approva la PR #40. Resta un miglioramento
non bloccante e preesistente: se l’upload successivo alla creazione fallisce, il
dialog resta aperto e «Crea» ripete la creazione invece di ritentare soltanto
l’upload. La seconda creazione viene rifiutata perché l’endpoint esiste già.
Questo caso resta fuori dalla patch di recupero e può essere affrontato separatamente.

Il tag 1.4.0 è già pubblicato, mentre la release GitHub è in bozza. Il §9 della
procedura di rilascio vieta di spostare o riutilizzare un tag per aggiungere codice:
la correzione richiede una nuova patch e artefatti ricostruiti. Nessuna modifica
al formato dei workspace o al contratto dell’admin API è necessaria.

## Verifica degli artefatti della 1.4.1

La PR #40 è stata integrata con lo squash `8e79502`. Il commit di release
`e37b0cc0ef1c244d79ca8f63ef223e5f47f989eb` e il tag `v1.4.1` sono sul remoto;
root, GUI ed Electron sono allineati alla 1.4.1. I risultati seguenti sono stati
registrati dopo la creazione del tag, senza modificare codice o artefatti.

- [Pipeline del tag](https://github.com/tosdan/mockxy/actions/runs/36701225960):
  tutti i job verdi, inclusi 1.086 test motore/Electron, 526 test GUI e 119 test
  Playwright, build Windows e Linux e creazione della bozza. Anche la
  [CI ordinaria](https://github.com/tosdan/mockxy/actions/runs/36701213874) e il
  [black-box](https://github.com/tosdan/mockxy/actions/runs/36701213793) sono verdi
  sullo stesso commit.
- I checksum della portable e dell’AppImage corrispondono a `SHA256SUMS.txt`.
  L’AppImage scaricato per il collaudo è identico a quello del bundle finale.
- Smoke test dell’AppImage distribuito: app e motore riportano 1.4.1; il workspace
  di fixture della 1.3.2 si apre, la sessione si ripristina dopo la riapertura,
  GUI, configurazione e OpenAPI rispondono, le definizioni dei mock restano
  invariate. Il controllo aggiornamenti reale risponde correttamente e vede
  ancora la release pubblica 1.3.2.
- **108 test contro GUI e motore inclusi nell’AppImage, senza ritentativi**, tutti
  passati. Sono compresi i due nuovi casi della #40, che fallivano sul pacchetto
  1.4.0: recupero di B e upload soltanto su B con A invariato. Gli 11 test di
  setup agent esclusi da questo harness usano un secondo server e sono coperti
  dai 119 test della pipeline.

La [bozza della 1.4.1](https://github.com/tosdan/mockxy/releases/tag/untagged-3cc2d7c0a7289691eab5)
contiene portable Windows, AppImage Linux e checksum. La 1.4.0 resta in bozza.
Prima di pubblicare la 1.4.1 restano la prova nativa della portable su Windows
(apertura workspace, ripristino sessione e controllo aggiornamenti) e
l’inserimento delle [note curate bilingui](NOTE-RILASCIO-v1.4.1.md) nella bozza.
Il token disponibile a `gh` non consente di accedere alle release in bozza;
l’aggiornamento delle note e la pubblicazione richiedono l’interfaccia GitHub.
