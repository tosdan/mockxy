# I controlli globali

Nella barra superiore dell'interfaccia vivono due interruttori che governano l'intero motore a
runtime. Sono **due interruttori indipendenti che producono tre modalità effettive**:

| Modalità | Mock / handler / middleware | Monitor | Proxy verso il backend |
|---|---|---|---|
| **Attivo** (default) | sì | registra | solo per le richieste senza mock ([fallback](PROXY.md)) |
| **Proxy totale** | no | registra | tutto |
| **Server spento** | no | fermo | tutto |

- **Proxy totale** sospende i mock senza fermare nulla: ogni richiesta va dritta al backend
  reale, ma il [monitor](MONITOR.md) continua a registrare. È la modalità «osserva il backend
  vero» — per confrontare il comportamento reale con i mock, o per catturare traffico da
  trasformare in mock. In questa modalità nemmeno i middleware intervengono: il backend si
  vede davvero com'è.
- **Server spento** non spegne il processo: il motore resta in piedi come **puro proxy
  trasparente**, con i mock sospesi *e* il monitor fermo. Serve a neutralizzare Mockxy senza
  toccare la configurazione del frontend che gli punta contro.

In entrambe le modalità non-attive, senza un backend configurato le richieste ricevono `501
Backend Not Configured`; le [connessioni di upgrade](WEBSOCKET.md) vengono sempre inoltrate.

Lo stato è **volutamente non persistito**: a ogni riavvio il motore torna in modalità attiva.
È un interruttore operativo, non un dato del workspace — un «proxy totale» dimenticato non
sopravvive alla sessione. Via API: `GET`/`PATCH /_admin/api/server`.
