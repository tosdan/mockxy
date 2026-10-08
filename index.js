const { parseCliArgs } = require("./src/config");
const { startServer } = require("./src/server");

async function bootstrap() {
  const argv = process.argv.slice(2);
  // `validate`: controlla gli script del workspace ed esce, senza avviare il server.
  if (argv[0] === "validate") {
    process.exitCode = require("./src/cli-validate").runValidateCommand(argv.slice(1));
    return;
  }
  const configOverrides = parseCliArgs(argv);
  await startServer({ configOverrides });
}

bootstrap().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
