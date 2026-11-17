const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { ActivationOverrideStore } = require("../src/mocks/activation-overrides");
const { createMemoryLogger, createTempDir, removeDir, writeHandler, writeMock, writeProxyMiddleware } = require("./helpers");

const A = "/_admin/api";

// Attivazioni temporanee: acceso/spento e variante servita per la sessione in corso, senza
// toccare i file del workspace. Quello che è salvato resta la decisione del team.
describe("attivazioni temporanee", () => {
  describe("store", () => {
    const endpoint = (overrides = {}) => ({
      method: "GET",
      path: "/ordini",
      enabled: false,
      responseFiles: ["001.response.json", "002.response.json"],
      selectedResponseFile: "001.response.json",
      ...overrides,
    });

    test("senza attivazione l'endpoint è quello salvato, lo stesso oggetto", () => {
      const store = new ActivationOverrideStore();
      const saved = endpoint();

      expect(store.applyTo(saved)).toBe(saved);
    });

    test("vince sul salvato solo per i campi decisi", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([{ method: "get", path: "/ordini", enabled: true }]);

      expect(store.applyTo(endpoint())).toMatchObject({ enabled: true, selectedResponseFile: "001.response.json" });

      store.apply([{ method: "GET", path: "/ordini", responseFile: "002.response.json" }]);
      expect(store.applyTo(endpoint())).toMatchObject({ enabled: true, selectedResponseFile: "002.response.json" });
      expect(store.list()).toEqual([{ method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
    });

    test("una variante che non esiste più fa decadere quel campo, e lo dice", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([{ method: "GET", path: "/ordini", enabled: true, responseFile: "009.response.json" }]);
      const dropped = [];

      expect(store.applyTo(endpoint(), dropped)).toMatchObject({ enabled: true, selectedResponseFile: "001.response.json" });
      expect(dropped).toEqual([{ method: "GET", path: "/ordini", reason: "variant_missing", responseFile: "009.response.json" }]);
      expect(store.list()).toEqual([{ method: "GET", path: "/ordini", enabled: true }]);
    });

    test("le attivazioni di endpoint spariti decadono", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([
        { method: "GET", path: "/ordini", enabled: true },
        { method: "GET", path: "/sparito", enabled: true },
      ]);
      const dropped = [];

      store.prune(new Set(["GET /ordini"]), dropped);

      expect(store.list().map((override) => override.path)).toEqual(["/ordini"]);
      expect(dropped).toEqual([{ method: "GET", path: "/sparito", reason: "endpoint_missing" }]);
    });

    test("un endpoint il cui file c'è ma non si legge non è sparito: l'attivazione resta", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([
        { method: "GET", path: "/ordini", enabled: true },
        { method: "GET", path: "/sparito", enabled: true },
      ]);
      store.applyTo(endpoint(), [], "/ws/ordini/GET.endpoint.json");
      store.applyTo(endpoint({ path: "/sparito" }), [], "/ws/sparito/GET.endpoint.json");
      const dropped = [];

      // /ordini non è fra gli endpoint letti perché il suo file è rotto; /sparito non c'è più.
      store.prune(new Set(), dropped, new Set(["/ws/ordini/GET.endpoint.json"]));

      expect(store.list().map((override) => override.path)).toEqual(["/ordini"]);
      expect(dropped).toEqual([{ method: "GET", path: "/sparito", reason: "endpoint_missing" }]);
    });

    test("restore rimette lo scenario fotografato, e non muove la revisione se è già quello", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([{ method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
      const before = store.snapshot();
      const revision = store.revision;

      expect(store.restore(before)).toBe(false);
      expect(store.revision).toBe(revision);

      store.remove("GET", "/ordini", ["responseFile"]);
      expect(store.restore(before)).toBe(true);
      expect(store.list()).toEqual(before);
    });

    test("togliere un campo lascia l'altro; senza campi l'attivazione sparisce; la revisione cresce solo se cambia qualcosa", () => {
      const store = new ActivationOverrideStore();
      store.replaceAll([{ method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
      const before = store.revision;

      expect(store.remove("GET", "/altro")).toBe(false);
      expect(store.revision).toBe(before);
      expect(store.remove("GET", "/ordini", ["enabled"])).toBe(true);
      expect(store.list()).toEqual([{ method: "GET", path: "/ordini", responseFile: "002.response.json" }]);
      expect(store.remove("GET", "/ordini", ["enabled"])).toBe(false);
      expect(store.remove("GET", "/ordini", ["responseFile"])).toBe(true);
      expect(store.size).toBe(0);
      expect(store.clear()).toBe(false);
    });
  });

  describe("sul motore", () => {
    let workspaceDir;
    let mocksDir;
    let runtime;
    let api;
    let logger;
    let ordini;
    let utenti;
    let attivo;

    async function startRuntime() {
      logger = createMemoryLogger();
      runtime = await createServerRuntime({
        configOverrides: {
          host: "127.0.0.1",
          mocksDir,
          filesDir: path.join(workspaceDir, "files"),
          monitorDumpDir: path.join(workspaceDir, "dump"),
          devWatch: false,
          adminApiEnabled: true,
          proxyFallbackEnabled: false,
        },
        logger,
      });
      api = request(runtime.app);
    }

    // Tutti i file del workspace, per provare che un'operazione non ne ha toccato nessuno.
    function snapshotFiles(dir = mocksDir, files = {}) {
      for (const name of fs.readdirSync(dir).sort()) {
        const filePath = path.join(dir, name);
        if (fs.statSync(filePath).isDirectory()) {
          snapshotFiles(filePath, files);
        } else {
          files[path.relative(mocksDir, filePath)] = fs.readFileSync(filePath, "utf8");
        }
      }
      return files;
    }

    const idOf = async (routePath) =>
      (await api.get(`${A}/mocks`)).body.items.find((item) => item.path === routePath).id;
    // Solo ciò che è temporaneo: `saved` e titolo/status della variante servita descrivono, non
    // decidono, e hanno il loro test.
    const temporaryOnly = ({ saved, responseTitle, responseStatus, ...temporary }) => temporary;
    const described = async () => (await api.get(`${A}/activation`)).body.items;
    const activation = async () => (await described()).map(temporaryOnly);

    beforeEach(async () => {
      workspaceDir = await createTempDir("activation-");
      mocksDir = path.join(workspaceDir, "mocks");
      // Come un repo per i test e2e: /ordini e /utenti spenti, /attivo acceso.
      await writeMock({ mocksDir, folder: "ordini", method: "GET", routePath: "/ordini", body: { stato: "ok" }, enabled: false });
      await writeMock({ mocksDir, folder: "utenti", method: "GET", routePath: "/utenti", body: ["anna"], enabled: false });
      await writeMock({ mocksDir, folder: "attivo", method: "GET", routePath: "/attivo", body: { attivo: true } });
      await startRuntime();
      ordini = await idOf("/ordini");
      utenti = await idOf("/utenti");
      attivo = await idOf("/attivo");
      // Seconda variante di /ordini, preparata senza selezionarla.
      await api.post(`${A}/mocks/${ordini}/responses`).send({ type: "mock", title: "Errore", status: 500, body: { errore: true }, select: false });
    });

    afterEach(async () => {
      await removeDir(workspaceDir);
    });

    test("lo scenario di un test: endpoint accesi con la variante scelta, e nessun file toccato", async () => {
      const before = snapshotFiles();
      const revisionBefore = (await api.get(`${A}/info`)).body.revisions.activation;

      const res = await api.put(`${A}/activation`).send({
        items: [
          { method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" },
          { id: utenti, enabled: true },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.items).toMatchObject([
        { id: ordini, method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" },
        { id: utenti, method: "GET", path: "/utenti", enabled: true },
      ]);
      expect(res.body.items[1]).not.toHaveProperty("responseFile");
      expect(await api.get("/ordini")).toMatchObject({ status: 500, body: { errore: true } });
      expect(await api.get("/utenti")).toMatchObject({ status: 200, body: ["anna"] });
      expect(snapshotFiles()).toEqual(before);
      // Il catalogo continua a dire ciò che è salvato.
      const catalog = (await api.get(`${A}/mocks`)).body.items.find((item) => item.id === ordini);
      expect(catalog).toMatchObject({ disabled: true, selectedResponseFile: "001.response.json" });
      expect((await api.get(`${A}/info`)).body.revisions.activation).toBeGreaterThan(revisionBefore);
    });

    test("ogni attivazione dice anche cosa è salvato e quale variante è servita, senza altre letture", async () => {
      const titles = (await api.get(`${A}/mocks/${ordini}`)).body.responses.map((response) => response.title);

      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "002.response.json" }, { id: attivo, enabled: false }] });

      expect(await described()).toEqual([
        // Senza variante temporanea non c'è titolo né status della variante servita: è quella salvata.
        {
          id: attivo, method: "GET", path: "/attivo", enabled: false,
          saved: { enabled: true, responseFile: "001.response.json", responseTitle: expect.any(String), responseStatus: 200 },
        },
        {
          id: ordini, method: "GET", path: "/ordini", enabled: true,
          responseFile: "002.response.json", responseTitle: "Errore", responseStatus: 500,
          saved: { enabled: false, responseFile: "001.response.json", responseTitle: titles[0], responseStatus: 200 },
        },
      ]);
    });

    test("il test successivo dichiara il suo scenario: ciò che non nomina torna a come è salvato", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "002.response.json" }, { id: utenti, enabled: true }] });

      const res = await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true }] });

      expect(res.body.items).toMatchObject([{ id: ordini, method: "GET", path: "/ordini", enabled: true }]);
      expect(res.body.items[0]).not.toHaveProperty("responseFile");
      expect(await api.get("/ordini")).toMatchObject({ status: 200, body: { stato: "ok" } });
      expect((await api.get("/utenti")).status).toBe(404);
    });

    test("azzerare riporta tutto a come è salvato, anche da vuoto", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true }] });

      const cleared = await api.delete(`${A}/activation`);
      const again = await api.delete(`${A}/activation`);

      expect(cleared.body.items).toEqual([]);
      expect(again.status).toBe(200);
      expect((await api.get("/ordini")).status).toBe(404);
    });

    test("un endpoint acceso nei file si può spegnere per la sessione", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: attivo, enabled: false }] });

      expect((await api.get("/attivo")).status).toBe(404);

      await api.delete(`${A}/activation`);
      expect((await api.get("/attivo")).status).toBe(200);
    });

    test("PATCH ritocca un endpoint e lascia il resto; null toglie un campo", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: utenti, enabled: true }] });

      await api.patch(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "002.response.json" }] });
      expect((await activation()).map((item) => item.path)).toEqual(["/ordini", "/utenti"]);

      await api.patch(`${A}/activation`).send({ items: [{ id: ordini, responseFile: null }] });
      expect(await activation()).toEqual([
        { id: ordini, method: "GET", path: "/ordini", enabled: true },
        { id: utenti, method: "GET", path: "/utenti", enabled: true },
      ]);
      expect(await api.get("/ordini")).toMatchObject({ status: 200, body: { stato: "ok" } });

      await api.patch(`${A}/activation`).send({ items: [{ id: ordini, enabled: null }] });
      expect((await activation()).map((item) => item.path)).toEqual(["/utenti"]);
    });

    test.each([
      ["corpo senza items", {}, 400, "MUTATION_REJECTED"],
      ["elemento senza endpoint", { items: [{ enabled: true }] }, 400, "MUTATION_REJECTED"],
      ["elemento senza campi", { items: [{ method: "GET", path: "/ordini" }] }, 400, "MUTATION_REJECTED"],
      ["campo sconosciuto", { items: [{ method: "GET", path: "/ordini", enabled: true, select: true }] }, 400, "MUTATION_REJECTED"],
      ["enabled non booleano", { items: [{ method: "GET", path: "/ordini", enabled: "si" }] }, 400, "MUTATION_REJECTED"],
      ["null in una dichiarazione intera", { items: [{ method: "GET", path: "/ordini", enabled: null }] }, 400, "MUTATION_REJECTED"],
      ["endpoint che non esiste", { items: [{ method: "GET", path: "/nessuno", enabled: true }] }, 404, "ACTIVATION_ENDPOINT_NOT_FOUND"],
      ["variante che non esiste", { items: [{ method: "GET", path: "/ordini", responseFile: "009.response.json" }] }, 400, "ACTIVATION_VARIANT_NOT_FOUND"],
      [
        "stesso endpoint due volte",
        { items: [{ method: "GET", path: "/ordini", enabled: true }, { method: "get", path: "/ordini", enabled: false }] },
        400,
        "MUTATION_REJECTED",
      ],
    ])("richiesta non valida (%s): rifiutata, e lo scenario in corso resta", async (_label, body, status, code) => {
      await api.put(`${A}/activation`).send({ items: [{ id: utenti, enabled: true }] });

      const res = await api.put(`${A}/activation`).send(body);

      expect(res.status).toBe(status);
      expect(res.body.details?.code).toBe(code);
      expect((await activation()).map((item) => item.path)).toEqual(["/utenti"]);
      expect((await api.get("/utenti")).status).toBe(200);
    });

    test("uno scenario che non si lascia installare viene rifiutato per intero: resta quello di prima", async () => {
      // Una variante handler il cui sorgente non c'è: esiste nell'elenco, ma non si carica.
      const endpointFile = path.join(mocksDir, "ordini", "GET.endpoint.json");
      const endpoint = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
      endpoint.responseFiles.push("003.response.json");
      fs.writeFileSync(endpointFile, JSON.stringify(endpoint, null, 2));
      fs.writeFileSync(
        path.join(mocksDir, "ordini", "GET.responses", "003.response.json"),
        JSON.stringify({ type: "handler", title: "Rotto", sourceFile: "003.handler.js" })
      );
      await api.put(`${A}/activation`).send({ items: [{ id: utenti, enabled: true }] });

      const res = await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "003.response.json" }] });

      expect(res.status).toBe(400);
      expect(res.body.details.code).toBe("ACTIVATION_REJECTED");
      expect((await activation()).map((item) => item.path)).toEqual(["/utenti"]);
      expect((await api.get("/utenti")).status).toBe(200);
      expect((await api.get("/ordini")).status).toBe(404);
    });

    describe("insieme ai salvataggi normali", () => {
      beforeEach(async () => {
        await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "002.response.json" }] });
      });

      test("modificare i dati di una variante o crearne una per il debug funziona, e lo scenario resta", async () => {
        const edited = await api.put(`${A}/mocks/${ordini}/responses/002.response.json`).send({ type: "mock", status: 500, body: { errore: "caso del bug" } });
        const created = await api.post(`${A}/mocks/${ordini}/responses`).send({ type: "mock", title: "Ad hoc", status: 418, body: { bug: 1 }, select: false });
        const savedVariant = await api.put(`${A}/mocks/${ordini}/responses/001.response.json`).send({ type: "mock", status: 200, body: { stato: "cambiato" } });

        expect([edited.status, created.status, savedVariant.status]).toEqual([200, 201, 200]);
        expect(await api.get("/ordini")).toMatchObject({ status: 500, body: { errore: "caso del bug" } });
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
      });

      test("spegnere nel modo normale vince: l'accensione temporanea decade, la variante temporanea no", async () => {
        const res = await api.put(`${A}/mocks/${ordini}/endpoint`).send({ enabled: false });

        expect(res.status).toBe(200);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", responseFile: "002.response.json" }]);
        expect((await api.get("/ordini")).status).toBe(404);
      });

      test("accendere nel modo normale salva nel file e lascia la variante temporanea", async () => {
        const res = await api.put(`${A}/mocks/${ordini}/endpoint`).send({ enabled: true });

        expect(res.body.disabled).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(mocksDir, "ordini", "GET.endpoint.json"), "utf8")).enabled).toBe(true);
        expect(await api.get("/ordini")).toMatchObject({ status: 500, body: { errore: true } });
      });

      test("accensione e spegnimento a elenco, e di una collection intera, fanno decadere il temporaneo", async () => {
        await api.patch(`${A}/activation`).send({ items: [{ id: utenti, enabled: true }] });

        const list = await api.patch(`${A}/mocks/enabled`).send({ ids: [utenti], enabled: false });
        expect(list.status).toBe(200);
        expect((await activation()).map((item) => item.path)).toEqual(["/ordini"]);
        expect((await api.get("/utenti")).status).toBe(404);

        const collection = (await api.post(`${A}/mocks/collections`).send({ label: "Gruppo" })).body;
        const collectionId = collection.id ?? collection.collection?.id;
        await api.put(`${A}/mocks/${ordini}/collection`).send({ collectionId });
        const toggled = await api.patch(`${A}/mocks/collections/${collectionId}/enabled`).send({ enabled: false });
        expect(toggled.status).toBe(200);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", responseFile: "002.response.json" }]);
        expect((await api.get("/ordini")).status).toBe(404);
      });

      test("selezionare nel modo normale vince sulla variante temporanea", async () => {
        const res = await api.put(`${A}/mocks/${ordini}`).send({ selectedResponseFile: "002.response.json" });

        expect(res.status).toBe(200);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true }]);
        expect(await api.get("/ordini")).toMatchObject({ status: 500 });
      });

      test("una variante nuova creata e selezionata vince; creata senza selezionarla no", async () => {
        await api.post(`${A}/mocks/${ordini}/responses`).send({ type: "mock", title: "Nuova", status: 201, body: { nuova: true } });

        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true }]);
        expect(await api.get("/ordini")).toMatchObject({ status: 201, body: { nuova: true } });
      });

      test("un salvataggio rifiutato non si porta via l'attivazione temporanea", async () => {
        const res = await api.put(`${A}/mocks/${ordini}/endpoint`).send({ enabled: "forse" });

        expect(res.status).toBe(400);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
        expect(await api.get("/ordini")).toMatchObject({ status: 500 });
      });

      test("eliminare la variante servita temporaneamente fa tornare a quella salvata; eliminare l'endpoint toglie l'attivazione", async () => {
        const deleted = await api.delete(`${A}/mocks/${ordini}/responses/002.response.json`);

        expect(deleted.status).toBe(200);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true }]);
        expect(await api.get("/ordini")).toMatchObject({ status: 200, body: { stato: "ok" } });
        expect(logger.entries.warn.some((entry) => entry.message.startsWith("Temporary activation dropped"))).toBe(true);

        await api.delete(`${A}/mocks/${ordini}`);
        expect(await activation()).toEqual([]);
      });

      test("una cancellazione rifiutata lascia lo scenario com'era, variante temporanea compresa", async () => {
        // La variante salvata non si carica più (manca il sorgente dell'handler): finché si serve
        // la 002 non si vede, ma senza la 002 l'endpoint non avrebbe nulla da servire.
        fs.writeFileSync(
          path.join(mocksDir, "ordini", "GET.responses", "001.response.json"),
          JSON.stringify({ type: "handler", title: "Rotto", sourceFile: "001.handler.js" })
        );
        await runtime.reloadRuntime();

        const res = await api.delete(`${A}/mocks/${ordini}/responses/002.response.json`);

        expect(res.status).toBe(400);
        expect(res.body.details.rollback).toBe("restored");
        expect(fs.existsSync(path.join(mocksDir, "ordini", "GET.responses", "002.response.json"))).toBe(true);
        expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true, responseFile: "002.response.json" }]);
        expect(await api.get("/ordini")).toMatchObject({ status: 500, body: { errore: true } });
      });

      test.each([
        ["handler", writeHandler, "resolveResponse() {\n    return { status: 200, jsonBody: { ok: true } };\n  }"],
        ["middleware", writeProxyMiddleware, "transformResponse({ response }) {\n    return response;\n  }"],
      ])("spegnere un %s salvandolo con definition.disabled vince sull'accensione temporanea", async (type, write, method) => {
        await write({ mocksDir, folder: "script", method: "GET", source: `module.exports = {\n  path: "/script",\n  disabled: true,\n  ${method},\n};` });
        await runtime.reloadRuntime();
        const script = await idOf("/script");
        await api.patch(`${A}/activation`).send({ items: [{ id: script, enabled: true }] });
        const { source } = (await api.get(`${A}/mocks/${script}`)).body;

        const res = await api.put(`${A}/mocks/${script}`).send({ type, definition: { path: "/script", disabled: true }, source });

        expect(res.status).toBe(200);
        expect(res.body.disabled).toBe(true);
        expect((await activation()).map((item) => item.path)).toEqual(["/ordini"]);
        expect((await api.get("/script")).status).toBe(404);
      });
    });

    test("un ricaricamento a caldo conserva lo scenario", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true, responseFile: "002.response.json" }] });

      await runtime.reloadRuntime();

      expect(await api.get("/ordini")).toMatchObject({ status: 500 });
      expect((await activation()).length).toBe(1);
    });

    test("un file endpoint momentaneamente illeggibile non fa decadere lo scenario", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true }] });
      const endpointFile = path.join(mocksDir, "ordini", "GET.endpoint.json");
      const saved = fs.readFileSync(endpointFile, "utf8");

      // Un salvataggio a metà di una modifica a mano: il runtime tiene la versione di prima.
      fs.writeFileSync(endpointFile, "{ a metà");
      await runtime.reloadRuntime();

      expect((await activation()).map((item) => item.path)).toEqual(["/ordini"]);
      expect((await api.get("/ordini")).status).toBe(200);

      fs.writeFileSync(endpointFile, saved);
      await runtime.reloadRuntime();

      expect(await activation()).toEqual([{ id: ordini, method: "GET", path: "/ordini", enabled: true }]);
      expect((await api.get("/ordini")).status).toBe(200);
    });

    test("un endpoint eliminato a mano fa decadere la sua attivazione", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true }, { id: utenti, enabled: true }] });

      fs.rmSync(path.join(mocksDir, "ordini"), { recursive: true });
      await runtime.reloadRuntime();

      expect((await activation()).map((item) => item.path)).toEqual(["/utenti"]);
      expect((await api.get("/ordini")).status).toBe(404);
    });

    test("un runtime nuovo riparte da ciò che è salvato", async () => {
      await api.put(`${A}/activation`).send({ items: [{ id: ordini, enabled: true }] });

      await startRuntime();

      expect(await activation()).toEqual([]);
      expect((await api.get("/ordini")).status).toBe(404);
    });

    test("dichiarare di nuovo lo scenario fa ripartire la memoria dell'handler", async () => {
      await writeHandler({
        mocksDir,
        folder: "contatore",
        method: "GET",
        source: `module.exports = {
  path: "/contatore",
  disabled: true,
  resolveResponse({ callCount }) {
    return { status: 200, jsonBody: { callCount } };
  },
};`,
      });
      await runtime.reloadRuntime();
      const scenario = { items: [{ method: "GET", path: "/contatore", enabled: true }] };
      await api.put(`${A}/activation`).send(scenario);
      await api.get("/contatore");
      expect((await api.get("/contatore")).body).toEqual({ callCount: 2 });

      await api.put(`${A}/activation`).send(scenario);

      expect((await api.get("/contatore")).body).toEqual({ callCount: 1 });
    });
  });
});
