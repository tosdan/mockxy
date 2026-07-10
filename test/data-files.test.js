const fs = require("fs");
const path = require("path");
const {
  normalizeDataFileName,
  listDataFileNames,
  createDataFileReader,
} = require("../src/mocks/data-files");
const { createTempDir, removeDir } = require("./helpers");

describe("data-files", () => {
  let filesDir;

  beforeEach(async () => {
    filesDir = await createTempDir("mockxy-files-");
  });

  afterEach(async () => {
    if (filesDir) {
      await removeDir(filesDir);
      filesDir = null;
    }
  });

  async function writeDataFile(name, value) {
    await fs.promises.writeFile(
      path.join(filesDir, `${name}.json`),
      typeof value === "string" ? value : JSON.stringify(value)
    );
  }

  describe("normalizeDataFileName", () => {
    test("normalizza a lowercase e scarta il suffisso .json di troppo", () => {
      expect(normalizeDataFileName("Utenti")).toBe("utenti");
      expect(normalizeDataFileName("utenti.json")).toBe("utenti");
      expect(normalizeDataFileName("  UTENTI.JSON  ")).toBe("utenti");
      expect(normalizeDataFileName("dati-2026_v1.min")).toBe("dati-2026_v1.min");
    });

    test("rifiuta nomi non validi (separatori di percorso, caratteri fuori pattern, non stringhe)", () => {
      expect(normalizeDataFileName("cartella/utenti")).toBeNull();
      expect(normalizeDataFileName("..\\segreti")).toBeNull();
      expect(normalizeDataFileName("con spazi")).toBeNull();
      expect(normalizeDataFileName("")).toBeNull();
      expect(normalizeDataFileName(42)).toBeNull();
      expect(normalizeDataFileName(null)).toBeNull();
    });
  });

  describe("listDataFileNames", () => {
    test("elenca i nomi canonici ordinati, ignorando i file non .json", async () => {
      await writeDataFile("utenti", []);
      await writeDataFile("aziende", []);
      await fs.promises.writeFile(path.join(filesDir, "note.txt"), "non json");

      await expect(listDataFileNames(filesDir)).resolves.toEqual(["aziende", "utenti"]);
    });

    test("cartella assente = elenco vuoto, non errore", async () => {
      await expect(listDataFileNames(path.join(filesDir, "inesistente"))).resolves.toEqual([]);
    });
  });

  describe("createDataFileReader", () => {
    test("legge e parsa il file richiesto", async () => {
      await writeDataFile("utenti", [{ id: 1, nome: "Ada" }]);
      const data = createDataFileReader(filesDir);

      await expect(data("utenti")).resolves.toEqual([{ id: 1, nome: "Ada" }]);
    });

    test("normalizza il riferimento: maiuscole e suffisso .json sono tollerati", async () => {
      await writeDataFile("utenti", { ok: true });
      const data = createDataFileReader(filesDir);

      await expect(data("Utenti")).resolves.toEqual({ ok: true });
      await expect(data("utenti.json")).resolves.toEqual({ ok: true });
    });

    test("ogni chiamata restituisce una copia indipendente (mutarla non inquina)", async () => {
      await writeDataFile("lista", [{ id: 1 }]);
      const data = createDataFileReader(filesDir);

      const first = await data("lista");
      first.push({ id: 99 });

      await expect(data("lista")).resolves.toEqual([{ id: 1 }]);
    });

    test("file mancante: errore esplicito che elenca i file disponibili", async () => {
      await writeDataFile("aziende", []);
      const data = createDataFileReader(filesDir);

      await expect(data("utenti")).rejects.toThrow(/no data file named 'utenti\.json'.*aziende/);
    });

    test("cartella vuota o assente: errore esplicito dedicato", async () => {
      const data = createDataFileReader(path.join(filesDir, "inesistente"));

      await expect(data("utenti")).rejects.toThrow(/folder is empty/);
    });

    test("JSON invalido: errore che indica il file e il problema di parsing", async () => {
      await writeDataFile("rotto", "{ non json ");
      const data = createDataFileReader(filesDir);

      await expect(data("rotto")).rejects.toThrow(/'rotto\.json' is not valid JSON/);
    });

    test("nome non valido: errore esplicito, nessun accesso al filesystem", async () => {
      const data = createDataFileReader(filesDir);

      await expect(data("../fuori")).rejects.toThrow(/invalid name/);
      await expect(data("a/b")).rejects.toThrow(/invalid name/);
      await expect(data(null)).rejects.toThrow(/invalid name/);
    });

    test("filesDir non configurata: errore esplicito alla chiamata", async () => {
      const data = createDataFileReader(undefined);

      await expect(data("utenti")).rejects.toThrow(/not configured/);
    });

    test("un file mai referenziato non viene mai letto (lazy per costruzione)", async () => {
      await writeDataFile("mai-usato", { pesante: true });
      const readSpy = jest.spyOn(fs.promises, "readFile");
      try {
        createDataFileReader(filesDir);
        expect(readSpy).not.toHaveBeenCalled();
      } finally {
        readSpy.mockRestore();
      }
    });
  });
});
