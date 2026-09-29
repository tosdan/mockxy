// Backend del collaudo del setup via API (piano agent/API, §9 S6 e §13 C6): un runtime separato
// da quello della suite, su un workspace di fixture isolato (workspace-agent-test/mocks). La run
// dir si ricrea a ogni avvio come per l'altro backend; i test di questo caso però non la
// ripristinano mai fra un caso e l'altro: il setup deve funzionare da qualunque stato.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "workspace-agent-test", ".run");
const runMocks = path.join(runDir, "mocks");

fs.rmSync(runMocks, { recursive: true, force: true });
fs.cpSync(path.join(root, "workspace-agent-test", "mocks"), runMocks, { recursive: true });
fs.mkdirSync(path.join(runDir, "dump"), { recursive: true });
fs.mkdirSync(path.join(runDir, "files"), { recursive: true });

require(path.join(root, "index.js"));
