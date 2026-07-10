// Generatore dell'icona dell'app desktop.
//
// Parte dalla sorgente vettoriale (build/icon.svg) e produce gli artefatti raster che servono:
// - build/icon.ico  → icona multi-risoluzione per l'eseguibile Windows (impostata dal packager) e
//                     per la finestra in sviluppo;
// - build/icon.png  → versione 512px, comoda come icona generica/anteprima.
//
// È un passo UNA TANTUM: si lancia a mano (`npm run icon`) quando il disegno cambia; gli artefatti
// generati vengono versionati, così la build di tutti i giorni non dipende da questi strumenti.

const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const pngToIcoExport = require("png-to-ico");
// A seconda della versione l'export è la funzione stessa o sta sotto `.default`.
const pngToIco = typeof pngToIcoExport === "function" ? pngToIcoExport : pngToIcoExport.default;

const buildDir = path.resolve(__dirname, "..", "build");
const svg = fs.readFileSync(path.join(buildDir, "icon.svg"), "utf8");

// Rasterizza la sorgente alla larghezza richiesta (l'icona è quadrata).
function renderPng(size) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  return resvg.render().asPng();
}

async function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = icoSizes.map(renderPng);

  fs.writeFileSync(path.join(buildDir, "icon.png"), renderPng(512));
  fs.writeFileSync(path.join(buildDir, "icon.ico"), await pngToIco(pngs));

  console.log(`Icona generata: icon.ico (${icoSizes.join(", ")}) + icon.png (512).`);
}

main().catch((error) => {
  console.error("Generazione icona fallita:", error);
  process.exit(1);
});
