// Backend "reale" finto per il collaudo dei tre scenari: qualche endpoint JSON credibile,
// uno lento e uno che fallisce, per dare al monitor traffico eterogeneo da catturare.
const http = require("http");

const utenti = [
  { id: 1, nome: "Anna Bianchi", ruolo: "admin", attivo: true },
  { id: 2, nome: "Luca Verdi", ruolo: "editor", attivo: true },
  { id: 3, nome: "Sara Neri", ruolo: "viewer", attivo: false },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/api/utenti" && req.method === "GET") {
    return send(200, utenti);
  }
  const matchUtente = url.pathname.match(/^\/api\/utenti\/(\d+)$/);
  if (matchUtente && req.method === "GET") {
    const utente = utenti.find((u) => u.id === Number(matchUtente[1]));
    return utente ? send(200, utente) : send(404, { error: "utente non trovato" });
  }
  if (url.pathname === "/api/ordini" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      send(201, { id: 42, stato: "creato", ricevuto: raw ? JSON.parse(raw) : null });
    });
    return;
  }
  if (url.pathname === "/api/preferenze" && req.method === "GET") {
    return send(200, { tema: "scuro", lingua: "it", notifiche: { email: true, push: false } });
  }
  if (url.pathname === "/api/lento" && req.method === "GET") {
    return setTimeout(() => send(200, { ok: true, dopoMs: 1500 }), 1500);
  }
  if (url.pathname === "/api/instabile" && req.method === "GET") {
    return send(500, { error: "errore interno del backend vero" });
  }
  send(404, { error: "not found", path: url.pathname });
});

server.listen(9333, "127.0.0.1", () => {
  console.log("fake backend su http://127.0.0.1:9333");
});
