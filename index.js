const { loadConfig, parseCliArgs } = require("./src/config");
const { resolveBundledUi, UI_BASE_HREF } = require("./src/bundled-ui");
const { startServer } = require("./src/server");
const { installScriptFaultGuard } = require("./src/script-fault-guard");

async function bootstrap() {
  const argv = process.argv.slice(2);
  // `validate`: controlla gli script del workspace ed esce, senza avviare il server.
  if (argv[0] === "validate") {
    process.exitCode = require("./src/cli-validate").runValidateCommand(argv.slice(1));
    return;
  }
  const configOverrides = parseCliArgs(argv);
  // Un errore lanciato da uno script del workspace fuori dalla sua richiesta non deve spegnere
  // il server. La guardia va messa prima dell'avvio (gli script si caricano lì); fino a quando
  // il runtime non ha un logger, scrive su stderr.
  let logger = { error: (message, fields) => console.error(message, fields) };
  installScriptFaultGuard({ getLogger: () => logger });
  // L'interfaccia compilata che sta accanto al motore si serve da sé, senza UI_DIST_DIR: basta
  // averla costruita una volta (o usare una distribuzione che la porta già con sé).
  const bundledUi = resolveBundledUi({ config: loadConfig(configOverrides), engineRoot: __dirname });
  if (bundledUi.uiDistDir != null) {
    configOverrides.uiDistDir = bundledUi.uiDistDir;
  }
  const runtime = await startServer({ configOverrides });
  logger = runtime.logger;
  announceInterface(runtime, bundledUi.hint);
}

// Dice dove si apre l'interfaccia, o perché non c'è: senza, chi avvia il motore da riga di
// comando non ha modo di saperlo.
function announceInterface(runtime, hint) {
  const announce = () => {
    if (runtime.config.uiDistDir != null) {
      const { host } = runtime.config;
      const shownHost = !host || host === "0.0.0.0" || host === "::" ? "localhost" : host;
      runtime.logger.info("Web interface available.", {
        url: `http://${shownHost}:${runtime.server.address().port}${UI_BASE_HREF}`,
      });
    } else if (hint != null) {
      runtime.logger.info(hint);
    }
  };
  if (runtime.server.listening) {
    announce();
  } else {
    runtime.server.once("listening", announce);
  }
}

bootstrap().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
