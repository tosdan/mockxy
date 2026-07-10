const fs = require("fs");
const path = require("path");

// Nomi ammessi per i file dati: sempre lowercase, cartella piatta (niente separatori di percorso,
// quindi nessuna traversal possibile per costruzione). Upload e rename normalizzano a lowercase
// per evitare ambiguità tra filesystem case-insensitive (Windows/macOS) e case-sensitive (Linux).
const DATA_FILE_NAME_PATTERN = /^[a-z0-9._-]+$/;
const DATA_FILE_EXTENSION = ".json";

// Normalizza un riferimento a file dati: trim, lowercase, suffisso .json di troppo scartato.
// Restituisce il nome canonico (senza estensione) o null se il riferimento non è valido.
function normalizeDataFileName(name) {
  if (typeof name !== "string") {
    return null;
  }

  let normalized = name.trim().toLowerCase();
  if (normalized.endsWith(DATA_FILE_EXTENSION)) {
    normalized = normalized.slice(0, -DATA_FILE_EXTENSION.length);
  }

  return DATA_FILE_NAME_PATTERN.test(normalized) ? normalized : null;
}

// Elenca i nomi canonici dei file dati presenti (senza estensione, ordinati). Cartella assente =
// nessun file: la cartella nasce pigramente al primo upload e la sua assenza non è un errore.
async function listDataFileNames(filesDir) {
  let entries;
  try {
    entries = await fs.promises.readdir(filesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(DATA_FILE_EXTENSION))
    .map((entry) => entry.name.slice(0, -DATA_FILE_EXTENSION.length))
    .sort();
}

// Crea l'accessor `data(name)` esposto nel contesto di handler e middleware. La lettura avviene
// solo alla chiamata: un file mai referenziato non viene mai aperto. Ogni chiamata rilegge e
// riparsa dal disco, così le modifiche sono visibili alla richiesta successiva e ogni handler
// riceve una copia propria (mutarla non inquina stato condiviso). Gli errori sono espliciti e
// diventano il fallimento standard dell'handler (500 con dettaglio nel log).
function createDataFileReader(filesDir) {
  return async function data(name) {
    if (filesDir == null) {
      throw new Error("data(): the data files folder is not configured (filesDir).");
    }

    const normalized = normalizeDataFileName(name);
    if (normalized == null || normalized === "") {
      throw new Error(
        `data(${JSON.stringify(name)}): invalid name. Allowed: lowercase letters, digits, '.', '_', '-'.`
      );
    }

    const filePath = path.resolve(filesDir, `${normalized}${DATA_FILE_EXTENSION}`);

    let text;
    try {
      text = await fs.promises.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        const available = await listDataFileNames(filesDir);
        const hint = available.length > 0
          ? `Available data files: ${available.join(", ")}.`
          : "The data files folder is empty.";
        throw new Error(`data('${normalized}'): no data file named '${normalized}.json'. ${hint}`);
      }
      throw error;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`data('${normalized}'): '${normalized}.json' is not valid JSON (${error.message}).`);
    }
  };
}

module.exports = {
  DATA_FILE_NAME_PATTERN,
  DATA_FILE_EXTENSION,
  normalizeDataFileName,
  listDataFileNames,
  createDataFileReader,
};
