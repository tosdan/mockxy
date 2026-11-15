# Mockxy completo in un solo container: motore, admin API e interfaccia web già compilata, servita
# dal motore sotto /_admin/ui/. È la via per USARE Mockxy senza installare Node né Angular:
# l'immagine porta l'applicazione, il workspace (mock, file dati, archivi) si monta a runtime
# (vedi docker-compose.app.yml). Per servire solo i mock, senza admin, c'è Dockerfile.standalone;
# per sviluppare Mockxy stesso, docker-compose.yml.

# --- 1. L'interfaccia: si compila qui e nell'immagine finale entrano solo i file statici.
FROM node:24-alpine AS ui
WORKDIR /ui
COPY mockxy-ui/package*.json ./
RUN npm ci
COPY mockxy-ui/ ./
# Il motore la monta sotto /_admin/ui/: la build deve dichiarare quel percorso base.
RUN npm run build -- --base-href=/_admin/ui/

# --- 2. Il motore, con le sole dipendenze di produzione.
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY src ./src
# `ui/` accanto al motore è dove index.js cerca l'interfaccia compilata (src/bundled-ui.js).
COPY --from=ui /ui/dist/mockxy-ui/browser ./ui

# Il workspace dell'utente: bind mount a runtime. La cartella esiste già, di proprietà
# dell'utente non privilegiato, così un volume vuoto parte scrivibile.
RUN mkdir -p /workspace/mocks /workspace/files && chown -R node:node /workspace
USER node

# Admin e watch accesi: è l'assetto di lavoro, non di pura erogazione. Sui bind mount gli eventi
# nativi del filesystem non sono affidabili, da qui il polling.
# HOST=0.0.0.0 perché il loopback del container non è raggiungibile dal port mapping: chi può
# raggiungere la porta può usare l'admin API, che scrive file ed esegue codice. L'esposizione
# si decide sull'host: il compose pubblica la porta solo su 127.0.0.1.
ENV ADMIN_API_ENABLED=true \
    DEV_WATCH=true \
    CHOKIDAR_USEPOLLING=true \
    MOCKS_DIR=/workspace/mocks \
    FILES_DIR=/workspace/files \
    MONITOR_DUMP_DIR=/workspace/.mockxy/monitor-dump \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000
CMD ["node", "index.js"]
