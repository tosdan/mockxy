const { parseCliArgs } = require("./src/config");
const { startServer } = require("./src/server");

async function bootstrap() {
  const configOverrides = parseCliArgs(process.argv.slice(2));
  await startServer({ configOverrides });
}

bootstrap().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
