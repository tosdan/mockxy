const { parseCliArgs } = require("./src/config");
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
  const runtime = await startServer({ configOverrides });
  logger = runtime.logger;
}

bootstrap().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
