# Benchmark dello stato runtime condiviso

Artefatto di review eseguito il 16 agosto 2026 per fissare la quota per-entry dell'MVP. Lo
script riproducibile è `scripts/benchmark-shared-state.js` e si avvia con:

```bash
npm run benchmark:shared-state
```

## Ambiente e protocollo

- Node `v24.18.0`;
- Linux x64 `7.0.0-28-generic`;
- AMD Ryzen 7 5825U with Radeon Graphics;
- array di plain object realistici generati deterministicamente con seed `0x5eed1234`;
- 5 campioni di warm-up e 30 misurati per operazione;
- GC esplicita **prima** di ogni campione, fuori dalla finestra cronometrata, per misurare il
  delta di memoria della singola operazione e non garbage cumulato fra campioni;
- Node in modalità normale; `--expose-gc` serve soltanto a stabilizzare la misura di memoria.

I gate decisi nel piano sono:

- `read()`: p95 ≤ 50 ms;
- `mutate()` no-op completa di parse, validazione e serializzazione: p95 ≤ 100 ms;
- `read()` + filtro/pagina rappresentativi: p95 ≤ 100 ms;
- delta massimo heap e RSS ≤ 128 MiB.

## Candidati scartati

La quota inizialmente proposta di 5 MiB non ha superato il gate più importante:

| Candidato | Operazione | p50 | p95 | max | heap Δ | RSS Δ | Esito |
|---:|---|---:|---:|---:|---:|---:|---|
| 5 MiB | mutate no-op | 105,80 ms | 108,75 ms | 110,70 ms | 25,97 MiB | 6,23 MiB | FAIL |
| 4 MiB | mutate no-op | 83,92 ms | 116,25 ms | 140,06 ms | 45,14 MiB | 4,02 MiB | FAIL |

Il candidato da 4 MiB aveva una mediana migliore, ma non margine sul p95: alcune raccolte V8
cadute durante la finestra sincrona hanno portato due campioni oltre la soglia. Usare la media o
la mediana avrebbe nascosto proprio il blocco occasionale dell'event loop che il gate vuole
contenere. Come stabilito dal piano, non è stata allentata la soglia: è stata ridotta la quota.

## Quota scelta: 3 MiB

Run finale:

| Dataset | Items | Operazione | p50 ms | p95 ms | max ms | heap Δ MiB | RSS Δ MiB | Gate |
|---:|---:|---|---:|---:|---:|---:|---:|---|
| 1,00 MiB | 3.087 | read | 2,58 | 3,21 | 3,22 | 1,42 | 1,25 | PASS |
| 1,00 MiB | 3.087 | mutate no-op | 18,20 | 23,18 | 25,93 | 27,04 | 2,29 | PASS |
| 1,00 MiB | 3.087 | read + filtro/pagina | 3,06 | 3,24 | 3,38 | 2,42 | 0,13 | PASS |
| 3,00 MiB | 9.257 | read | 7,47 | 9,75 | 9,77 | 4,24 | 4,25 | PASS |
| 3,00 MiB | 9.257 | mutate no-op | 59,26 | 77,99 | 85,39 | 19,74 | 3,16 | PASS |
| 3,00 MiB | 9.257 | read + filtro/pagina | 9,96 | 10,82 | 11,07 | 6,51 | 0,00 | PASS |

Il p95 della mutazione massima resta circa 22 ms sotto soglia e tutti i delta di memoria sono
ampiamente sotto 128 MiB. La quota pubblicata è quindi **3 MiB per risorsa**, con totale invariato
a 25 MiB. Un risultato futuro migliore non autorizza da solo ad alzarla: occorrono casi d'uso
reali, nuovo benchmark e nuova decisione esplicita.
