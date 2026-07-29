// Generatore dell'icona dell'app desktop.
//
// Parte dalla sorgente vettoriale (build/icon.svg) e produce gli artefatti raster che servono:
// - build/icon.ico  → icona multi-risoluzione per l'eseguibile Windows (impostata dal packager) e
//                     per la finestra in sviluppo;
// - build/icon.png  → versione 512px, comoda come icona generica/anteprima.
// - build/appx/*.png → tile e logo richiesti dal manifest AppX.
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

function renderAppxAsset(width, height, iconSize) {
  const iconX = (width - iconSize) / 2;
  const iconY = (height - iconSize) / 2;
  const embeddedIcon = Buffer.from(svg, "utf8").toString("base64");
  const assetSvg = [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`,
    ' xmlns="http://www.w3.org/2000/svg">',
    `<rect width="${width}" height="${height}" fill="#474e60"/>`,
    `<image x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}"`,
    ` href="data:image/svg+xml;base64,${embeddedIcon}"/>`,
    "</svg>",
  ].join("");
  return new Resvg(assetSvg).render().asPng();
}

async function main() {
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = icoSizes.map(renderPng);
  const appxDir = path.join(buildDir, "appx");

  fs.writeFileSync(path.join(buildDir, "icon.png"), renderPng(512));
  fs.writeFileSync(path.join(buildDir, "icon.ico"), await pngToIco(pngs));
  fs.mkdirSync(appxDir, { recursive: true });
  for (const [name, width, height, iconSize] of [
    ["StoreLogo.png", 50, 50, 42],
    ["Square44x44Logo.png", 44, 44, 38],
    ["Square150x150Logo.png", 150, 150, 128],
    ["Wide310x150Logo.png", 310, 150, 128],
  ]) {
    fs.writeFileSync(path.join(appxDir, name), renderAppxAsset(width, height, iconSize));
  }

  console.log(
    `Icona generata: icon.ico (${icoSizes.join(", ")}), icon.png (512) e asset AppX.`,
  );
}

main().catch((error) => {
  console.error("Generazione icona fallita:", error);
  process.exit(1);
});
