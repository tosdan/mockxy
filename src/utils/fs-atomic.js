const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Scrittura atomica: file temporaneo nella stessa cartella + rename sul target. Un crash a
// metà scrittura lascia al più un temporaneo orfano, mai il target troncato — il rename è
// atomico sullo stesso filesystem (per questo il temporaneo NON va in una tmp dir di sistema,
// che può stare su un volume diverso); su Windows sovrascrive il target esistente.
// Il nome inizia col punto e finisce in .tmp: non combacia con nessun suffisso caricato dal
// loader degli endpoint, quindi un orfano non inquina mai il workspace.
async function writeFileAtomic(filePath, data, options) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );

  await fs.promises.writeFile(temporaryPath, data, options);
  try {
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
}

module.exports = { writeFileAtomic };
