# 21 — Da traffico a mock: la cattura

Il flusso più caratteristico di Mockxy: una risposta vera, osservata nel monitor, diventa un
mock con tutto già pronto — metodo e percorso dalla richiesta; status, header e body dalla
risposta. Niente da trascrivere, niente da inventare: si **congela ciò che il backend ha
davvero risposto**, nel momento in cui i dati sono quelli giusti.

## La cattura singola

Dal dettaglio di una voce del monitor, **«Crea mock da questa»** crea l'endpoint con la
response catturata come prima variante. Il toast di conferma offre la scorciatoia **«Apri il
mock creato»**, che porta dritto alla scheda nel catalogo per l'eventuale ritocco.

L'esempio guida — lo staging che verrà resettato: la mattinata è passata a inserire ordini
dalle maschere dell'app, e `GET /api/ordini` risponde finalmente con dati ben popolati. Prima
del prossimo reseeding: monitor, voce del `GET /api/ordini`, «Crea mock da questa» — e quello
scenario è al sicuro in un file, riproducibile per sempre e versionabile in git. Al reset
successivo il frontend continua a vedere i *suoi* dati.

Le regole del travaso, pensate perché il mock nasca pulito:

- gli header **mascherati** (`Authorization`, `Cookie`…) non finiscono nel mock — niente
  `***` fossilizzati — e nemmeno quelli che il server ricalcola da sé (`Content-Length` e
  simili);
- gli header CORS della risposta catturata viaggiano nel mock come gli altri (con il CORS
  automatico attivo è comunque la policy del motore a vincere);
- un body **non ricostruibile** — binario, o troncato perché oltre la soglia di cattura dei
  156 KB — produce comunque il mock, ma come **skeleton da completare**: struttura pronta e
  body da riempire, con la condizione marcata nella descrizione. Meglio uno scheletro
  esplicito che un mock silenziosamente monco.

## Quando l'endpoint esiste già

Se per quella rotta e quel metodo il catalogo ha già un endpoint, la cattura singola non
fallisce e non duplica: la dialog **«Il mock esiste già»** propone di aggiungere la risposta
catturata come **nuova variante** dell'endpoint esistente. Confermando, la variante nasce con
il titolo «dal monitor · HH:mm:ss» e diventa **quella selezionata**; le varianti precedenti
restano intatte, pronte da riselezionare.

È il modo naturale di far crescere la dotazione di un endpoint: il caso reale di oggi si
aggiunge ai casi già congelati ieri.

> 📷 **SCREENSHOT** — `21-dialog-esiste.png`
> Cosa mostrare: la dialog «Il mock esiste già» con la domanda di aggiunta come variante e i
> pulsanti Annulla / «Aggiungi come variante».

## La cattura in blocco

Il pulsante **«Seleziona»** del monitor attiva la modalità di selezione multipla: si spuntano
le voci — tipicamente tutte le chiamate di una schermata appena navigata — e **«Crea mock
(N)»** le trasforma in un colpo solo. Il riepilogo finale rende conto di ogni esito: quante
**create**, quante **skeleton** da completare, quante **non create** (ad esempio perché già
esistenti).

Una differenza voluta rispetto alla cattura singola: il batch **salta gli endpoint
esistenti** invece di proporre l'aggiunta di varianti — un'operazione in blocco non deve fare
domande a raffica. Per aggiungere una variante a un endpoint che esiste già, si passa dalla
cattura singola.

> 📷 **SCREENSHOT** — `21-selezione-multipla.png`
> Cosa mostrare: il monitor in modalità selezione con più voci spuntate e il pulsante «Crea
> mock (N)» attivo; idealmente anche il toast di riepilogo con i conteggi.

## Il flusso completo, con il proxy totale

La versione sistematica del flusso usa la modalità **proxy totale**
([capitolo 5](05-tour-interfaccia.md)) come modalità di cattura: i mock esistenti vengono
sospesi, tutto passa dal backend vero, e il monitor registra il comportamento *reale*
dell'intera applicazione — anche sulle rotte che un mock già coprirebbero. Si naviga
l'applicazione nelle schermate che interessano, si torna al monitor, si seleziona e si crea
in blocco. Poi si spegne il proxy totale: i mock — vecchi e nuovi — tornano in servizio.

Il mock creato è un endpoint come tutti gli altri: file su disco, varianti, ritocchi
dall'editor. Da quel momento il confine mock/reale si è spostato di un endpoint — ed è
esattamente il progetto di Mockxy.

La vista live però dimentica: 250 richieste, poi le più vecchie escono. Per catturare *dal
passato* — la sessione di martedì, riscoperta utile giovedì — serve l'archivio su disco:
[lo storico dump](22-storico-dump.md).
