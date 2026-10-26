const express = require("express");
const { setNoCacheHeaders } = require("./utils/cache");
const { ENGINE_VERSION } = require("./runtime-info");

// Health del runtime per orchestratori e load balancer (analisi dello staging condiviso, D7).
// Vive sotto /_admin/api, il prefisso che il motore riserva davvero, ma non fa parte dell'admin:
// app.js lo monta prima del router admin, della risposta «admin disattivata» e della guardia
// sull'header Host, così risponde anche con l'admin spenta e a chi chiama con l'IP del container.
//
// 200 con il workspace caricato senza errori, 503 altrimenti: uno staging partito con un file
// rotto non risulta sano mentre un endpoint mockato manca. Dei file rotti espone solo i percorsi
// relativi, gli stessi che stanno in git: i messaggi, che possono citare il contenuto dei file o
// percorsi del server, restano nel log di avvio. Gli avvisi sugli script non cambiano lo stato.
function createHealthRouter({ runtimeStatus, config } = {}) {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    const snapshot = runtimeStatus?.snapshot();
    const errors = (snapshot?.errors ?? []).map(({ filePath }) => ({ filePath }));
    // Una ricarica fallita del tutto lascia in uso il registro precedente, ma il workspace su
    // disco non è quello servito: non è sano neanche con zero errori registrati.
    const healthy = errors.length === 0 && snapshot?.lastAttempt?.status !== "failed";
    setNoCacheHeaders(res);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      mockxyVersion: ENGINE_VERSION,
      mocksVersion: config?.mocksVersion ?? null,
      errors,
    });
  });
  return router;
}

module.exports = { createHealthRouter };
