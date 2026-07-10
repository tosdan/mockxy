const path = require("path");
const {
  buildDataFileUsageIndex,
  collectReferencingSources,
  extractDataReferences,
  rewriteDataReferences,
} = require("../src/mocks/data-file-usage");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createTempDir, removeDir, writeHandler, writeProxyMiddleware } = require("./helpers");

describe("data-file-usage", () => {
  describe("extractDataReferences", () => {
    it("cattura i riferimenti letterali con virgolette singole, doppie e backtick", () => {
      const names = extractDataReferences(`
        const a = await data('utenti');
        const b = await data("aziende");
        const c = await data(\`ruoli\`);
      `);
      expect([...names].sort()).toEqual(["aziende", "ruoli", "utenti"]);
    });

    it("normalizza a lowercase e scarta il suffisso .json", () => {
      const names = extractDataReferences(`data('Utenti'); data("aziende.json")`);
      expect([...names].sort()).toEqual(["aziende", "utenti"]);
    });

    it("ignora i riferimenti dinamici (variabile, concatenazione, parametro)", () => {
      const names = extractDataReferences(`
        const n = 'utenti'; data(n);
        data('ute' + 'nti');
        data(query.which);
      `);
      expect([...names]).toEqual([]);
    });

    it("deduplica lo stesso nome citato più volte", () => {
      const names = extractDataReferences(`data('x'); data('x'); data("x")`);
      expect([...names]).toEqual(["x"]);
    });
  });

  describe("rewriteDataReferences", () => {
    it("riscrive il nome preservando virgolette e spaziatura, e conta le occorrenze", () => {
      const input = `a = await data('utenti'); b = await data( "utenti" ); c = data(\`utenti\`);`;
      const { source, count } = rewriteDataReferences(input, "utenti", "persone");
      expect(count).toBe(3);
      expect(source).toBe(`a = await data('persone'); b = await data( "persone" ); c = data(\`persone\`);`);
    });

    it("tocca solo il file indicato (per nome canonico), lasciando gli altri", () => {
      const input = `data('utenti'); data("Utenti.json"); data('aziende');`;
      const { source, count } = rewriteDataReferences(input, "utenti", "persone");
      // sia 'utenti' che 'Utenti.json' normalizzano a "utenti" → entrambi riscritti; 'aziende' intatto
      expect(count).toBe(2);
      expect(source).toBe(`data('persone'); data("persone"); data('aziende');`);
    });

    it("non tocca i riferimenti dinamici", () => {
      const input = `const n = 'utenti'; data(n); data('ute' + 'nti');`;
      const { source, count } = rewriteDataReferences(input, "utenti", "persone");
      expect(count).toBe(0);
      expect(source).toBe(input);
    });
  });

  describe("collectReferencingSources", () => {
    let mocksDir;

    beforeEach(async () => {
      mocksDir = await createTempDir("collect-");
    });

    afterEach(async () => {
      if (mocksDir) {
        await removeDir(mocksDir);
        mocksDir = null;
      }
    });

    it("restituisce i sorgenti che referenziano il nome, con contenuto ed endpoint", async () => {
      await writeHandler({
        mocksDir,
        folder: "a",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/a",
  async resolveResponse({ data }) {
    return { jsonBody: await data("utenti") };
  }
};`,
      });

      const sources = collectReferencingSources(mocksDir, "utenti");
      expect(sources).toHaveLength(1);
      expect(sources[0].endpoint.path).toBe("/a");
      expect(sources[0].type).toBe("handler");
      expect(sources[0].source).toContain('data("utenti")');
    });

    it("elenco vuoto se nessun sorgente referenzia il nome o manca mocksDir", async () => {
      expect(collectReferencingSources(mocksDir, "utenti")).toEqual([]);
      expect(collectReferencingSources(null, "utenti")).toEqual([]);
    });
  });

  describe("buildDataFileUsageIndex", () => {
    let mocksDir;

    beforeEach(async () => {
      mocksDir = await createTempDir("usage-");
    });

    afterEach(async () => {
      if (mocksDir) {
        await removeDir(mocksDir);
        mocksDir = null;
      }
    });

    it("mappa ogni file agli endpoint che lo referenziano (handler e middleware)", async () => {
      await writeHandler({
        mocksDir,
        folder: "a",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/a",
  async resolveResponse({ data }) {
    return { jsonBody: await data("utenti") };
  }
};`,
      });
      await writeProxyMiddleware({
        mocksDir,
        folder: "b",
        method: "POST",
        source: `module.exports = {
  method: "POST",
  path: "/b",
  async transformResponse({ data }) {
    return { jsonBody: await data("utenti") };
  }
};`,
      });

      const index = buildDataFileUsageIndex(mocksDir);
      const usedBy = index.get("utenti");

      expect(usedBy).toEqual(
        expect.arrayContaining([
          { id: encodeMockId("a/GET.endpoint.json"), method: "GET", path: "/a", type: "handler" },
          { id: encodeMockId("b/POST.endpoint.json"), method: "POST", path: "/b", type: "middleware" },
        ])
      );
      expect(usedBy).toHaveLength(2);
    });

    it("un endpoint che referenzia più file compare sotto ciascuno", async () => {
      await writeHandler({
        mocksDir,
        folder: "multi",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/multi",
  async resolveResponse({ data }) {
    return { jsonBody: [await data("utenti"), await data("aziende")] };
  }
};`,
      });

      const index = buildDataFileUsageIndex(mocksDir);
      expect(index.get("utenti")).toHaveLength(1);
      expect(index.get("aziende")).toHaveLength(1);
      expect(index.get("utenti")[0].path).toBe("/multi");
    });

    it("un file non referenziato da nessun sorgente non compare nell'indice", async () => {
      await writeHandler({
        mocksDir,
        folder: "a",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/a",
  async resolveResponse() {
    return { jsonBody: [] };
  }
};`,
      });

      const index = buildDataFileUsageIndex(mocksDir);
      expect(index.has("utenti")).toBe(false);
    });

    it("mocksDir nullo o inesistente → indice vuoto, nessun errore", () => {
      expect(buildDataFileUsageIndex(null).size).toBe(0);
      expect(buildDataFileUsageIndex(path.join(mocksDir, "inesistente")).size).toBe(0);
    });
  });
});
