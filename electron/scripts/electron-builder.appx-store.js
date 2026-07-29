const { createAppxBuildConfig, loadStoreIdentity } = require("./store-package-config");

// La build da caricare in Partner Center non ammette fallback: i tre valori devono essere
// copiati dalla pagina Product identity nel file locale ignorato da Git (o nel file indicato
// da MOCKXY_STORE_IDENTITY_FILE).
module.exports = createAppxBuildConfig(loadStoreIdentity());
