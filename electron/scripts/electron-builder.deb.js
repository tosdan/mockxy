const { createDebBuildConfig } = require("./deb-package-config");

// Pacchetto installabile diretto per Debian e Ubuntu. Resta separato dall'AppImage e non
// configura un repository APT né un meccanismo di aggiornamento automatico.
module.exports = createDebBuildConfig();
