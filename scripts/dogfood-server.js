// Avvia il motore per il GIRO DI COLLAUDO da utente (vedi docs/progetto/BACKLOG-PRODOTTO.md, note di
// metodo): porta dedicata, workspace scratch locale (gitignored, azzerabile senza rimpianti),
// UI compilata servita dal motore, backend finto di scripts/dogfood-backend.js come upstream.
// Prerequisito: npm run build:frontend:desktop (la UI compilata sotto /_admin/ui/).
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const scratch = path.join(repoRoot, ".dogfood");

process.env.PORT = process.env.PORT || "3344";
process.env.NODE_ENV = "development";
process.env.MOCKS_DIR = path.join(scratch, "workspace", "mocks");
process.env.FILES_DIR = path.join(scratch, "workspace", "files");
process.env.BACKEND_URL = "http://127.0.0.1:9333";
process.env.PROXY_FALLBACK_ENABLED = "true";
process.env.ADMIN_API_ENABLED = "true";
process.env.UI_DIST_DIR = path.join(repoRoot, "mockxy-ui", "dist", "mockxy-ui", "browser");

require(path.join(repoRoot, "index.js"));
