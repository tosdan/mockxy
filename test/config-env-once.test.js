// Il .env va letto una volta sola per processo (#29): dotenv muta process.env e nell'app
// desktop il runtime si ricrea a ogni cambio workspace — senza guardia, ogni loadConfig
// rileggerebbe il file dal cwd corrente. File di test separato: il mock di dotenv vale per
// il registro moduli di questo solo file.
jest.mock("dotenv", () => ({ config: jest.fn() }));

const dotenv = require("dotenv");
const { loadConfig } = require("../src/config");

describe("caricamento del file .env", () => {
  test("dotenv.config viene eseguito una volta sola anche con più loadConfig", () => {
    loadConfig({ backendUrl: undefined });
    loadConfig({ backendUrl: undefined, host: "127.0.0.1" });
    loadConfig({ backendUrl: undefined, mocksDir: "D:/x" });

    expect(dotenv.config).toHaveBeenCalledTimes(1);
  });
});
