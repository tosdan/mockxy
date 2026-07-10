const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function createLogger(level = "info") {
  const currentLevel = LEVELS[level] ?? LEVELS.info;

  function write(logLevel, message, fields = {}) {
    if ((LEVELS[logLevel] ?? LEVELS.info) > currentLevel) {
      return;
    }

    const payload = {
      time: new Date().toISOString(),
      level: logLevel,
      msg: message,
      ...fields,
    };

    const line = JSON.stringify(payload);
    if (logLevel === "error") {
      process.stderr.write(`${line}\n`);
      return;
    }

    process.stdout.write(`${line}\n`);
  }

  return {
    error(message, fields) {
      write("error", message, fields);
    },
    warn(message, fields) {
      write("warn", message, fields);
    },
    info(message, fields) {
      write("info", message, fields);
    },
    debug(message, fields) {
      write("debug", message, fields);
    },
  };
}

module.exports = {
  createLogger,
};
