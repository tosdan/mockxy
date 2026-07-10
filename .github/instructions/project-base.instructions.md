---
description: Queste istruzioni forniscono linee guida per scrivere codice in questo progetto, con un focus su manutenibilità e chiarezza.
applyTo: '**/*.ts, **/*.js'
---

Usa i componenti grafici di PrimeNG prima di creare nuovi elementi di UI, in modo da mantenere coerenza visiva e ridurre il tempo di sviluppo. Se un componente PrimeNG esistente soddisfa le esigenze funzionali, preferiscilo rispetto alla creazione di un nuovo componente personalizzato.

Limita il CSS custom alle situazioni in cui è strettamente necessario per ottenere l'aspetto desiderato, ma cerca di sfruttare lo styling e le classi predefinite di PrimeNG per mantenere un design coerente e semplificare la manutenzione. Se devi aggiungere CSS custom, organizza le regole in modo chiaro e documenta eventuali scelte di design particolari o workaround necessari per integrare con PrimeNG.

Scrivi codice fattorizzato, con funzioni pure e con responsabilità ben definite, in modo da facilitare la manutenzione e l'estensione futura del progetto. Evita duplicazioni di codice e cerca di seguire i principi SOLID per garantire un'architettura modulare e scalabile.

Commenta ogni funzione e modulo in modo chiaro, spiegando il loro scopo, i parametri di input e output, e qualsiasi comportamento particolare o edge case che potrebbero gestire. Questo aiuterà altri sviluppatori (o te stesso in futuro) a comprendere rapidamente il codice e a diagnosticare eventuali problemi.

Per ogni modulo crea e mantieni aggiornato un file <nome_modulo>-readme.md che spiega il ruolo del modulo, le sue dipendenze, e fornisce esempi di utilizzo.