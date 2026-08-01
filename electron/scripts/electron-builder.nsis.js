const { createNsisBuildConfig } = require("./nsis-package-config");

// Installer diretto scaricabile dalle release GitHub: resta separato dalla portable e dalla
// configurazione Store. La firma del codice verrà valutata in un incremento dedicato.
module.exports = createNsisBuildConfig();
