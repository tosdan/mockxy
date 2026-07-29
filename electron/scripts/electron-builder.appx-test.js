const { createAppxBuildConfig, localTestIdentity } = require("./store-package-config");

// Pacchetto non destinato a Partner Center: usa un'identità esplicitamente locale e resta
// non firmato. Serve per ispezionare manifest, asset e comportamento AppX prima di riservare
// l'identità definitiva.
module.exports = createAppxBuildConfig(localTestIdentity);
