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
