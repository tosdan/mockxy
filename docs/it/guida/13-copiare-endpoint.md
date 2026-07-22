# 13 — Copiare endpoint e riusare il lavoro

Un endpoint ben rifinito — header giusti, varianti per i casi d'errore, body curati — è
lavoro che conviene riusare. Il pulsante **Copia** nella scheda dell'endpoint duplica tutto
su un nuovo metodo e/o percorso, senza rifare nulla a mano.

## La dialog

La dialog mostra l'origine («da GET /api/...») e chiede:

- **Metodo** — quello del nuovo endpoint, precompilato con l'originale;
- **Path** — il nuovo percorso, con le stesse validazioni della creazione
  ([capitolo 7](07-creare-endpoint.md)); la coppia metodo+percorso deve essere nuova, un
  duplicato esatto non è ammesso;
- **Copia tutte le response** — attivo, porta nel nuovo endpoint **tutte** le varianti
  (inclusi gli script degli handler e dei middleware referenziati, che vengono duplicati);
  spento, copia **solo la variante attualmente selezionata**. La seconda modalità è la
  scelta giusta quando delle molte varianti dell'originale ne serve una sola come base di
  partenza.

Il nuovo endpoint è indipendente dall'originale: da lì in poi i due evolvono ciascuno per
conto proprio.

> 📷 **SCREENSHOT** — `13-dialog-copia.png`
> Cosa mostrare: la dialog «Copia endpoint» compilata, con l'origine visibile nel
> sottotitolo, il nuovo path valorizzato e l'interruttore «Copia tutte le response» attivo
> con il conteggio.

## Quando torna utile

- **La variante di metodo**: il `GET /api/ordini/:id` è pronto, serve il `PUT` sullo stesso
  percorso — copia con cambio di metodo, poi si ritocca il body di risposta. Gli header e la
  struttura restano.
- **La risorsa gemella**: `GET /api/clienti` è rifinito e serve `GET /api/fornitori` con la
  stessa forma — copia con cambio di percorso e si sostituiscono i dati.
- **La versione nuova dell'API**: il backend introduce `/api/v2/...` — si copiano gli
  endpoint v1 sul percorso v2 e si applicano le differenze di contratto, tenendo vive
  entrambe le versioni durante la transizione.
- **L'endpoint "modello"**: in team può convenire un endpoint di riferimento con la dotazione
  standard (200 + lista vuota + 500, header aziendali) da copiare come scheletro di ogni
  nuovo mock.

Un'alternativa alla copia via interfaccia, per i rifacimenti di massa: i mock sono file, e
una cartella di endpoint si duplica anche da file manager o con uno script — con le
avvertenze sui nomi e i campi da aggiornare descritte nel [capitolo 24](24-mock-come-file.md).

Prossimo capitolo, ultimo della parte sui mock statici: portare nel quadro la variabile che
in locale non esiste mai — la latenza. [I ritardi simulati](14-ritardi.md).
