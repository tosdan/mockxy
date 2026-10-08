const path = require("path");
const acorn = require("acorn");

// Controllo sintattico del contratto degli script (docs/it/HANDLER.md, «Helper condivisi»).
//
// Le dipendenze locali vanno importate in cima al modulo, con un percorso letterale ed esplicito.
// Il motivo è il reload: una funzione di risposta conserva i riferimenti acquisiti al
// caricamento, quindi una richiesta in corso finisce con il codice con cui è iniziata. Un
// `require` eseguito durante una richiesta, invece, dopo un reload restituisce il codice nuovo.
// Questo caso non si vede dal grafo dei moduli (può richiedere di nuovo un helper già noto):
// serve guardare il sorgente, e serve un parser per non scambiare stringhe e commenti per codice.
//
// È un controllo per gli errori ordinari, non una prova di purezza: usato dalla validazione
// completa e al salvataggio dall'admin, mai nella scansione ordinaria.

const FUNCTION_NODES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const SKIPPED_KEYS = new Set(["type", "start", "end", "loc", "range"]);

// Node compila uno script CommonJS dentro una funzione: per questo a livello di modulo valgono
// `return`, `new.target` e `arguments`. Analizzare il sorgente avvolto allo stesso modo accetta
// esattamente quella sintassi, senza elencarne le eccezioni una per una. Il prefisso sta sulla
// prima riga del sorgente, quindi le righe non cambiano: si corregge solo la colonna della prima.
const WRAPPER_PREFIX = "(function (exports, require, module, __filename, __dirname) {";
const WRAPPER_SUFFIX = "\n})";

// Restituisce il corpo dello script: le istruzioni a livello di modulo.
function parseScript(source) {
  // Node toglie l'hashbang prima di avvolgere; qui lo si neutralizza senza spostare le righe.
  const body = source.startsWith("#!") ? `//${source.slice(2)}` : source;
  const program = acorn.parse(`${WRAPPER_PREFIX}${body}${WRAPPER_SUFFIX}`, {
    ecmaVersion: "latest",
    sourceType: "script",
    locations: true,
  });
  return program.body[0].expression.body;
}

function isLocalSpecifier(specifier) {
  return /^\.{1,2}(\/|\\|$)/.test(specifier) || specifier.startsWith("#");
}

function literalSpecifier(argument) {
  if (argument == null) {
    return null;
  }
  if (argument.type === "Literal" && typeof argument.value === "string") {
    return argument.value;
  }
  if (argument.type === "TemplateLiteral" && argument.expressions.length === 0) {
    return argument.quasis[0].value.cooked;
  }
  return null;
}

function isRequireCall(node) {
  return node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require";
}

function violation(code, node, message) {
  const { line, column } = node.loc.start;
  return { code, line, column: (line === 1 ? column - WRAPPER_PREFIX.length : column) + 1, message };
}

// Un campo di istanza non statico viene inizializzato a ogni `new`, quindi durante le richieste:
// il suo valore è codice differito quanto il corpo di una funzione. I campi `static` e i blocchi
// `static {}` girano invece alla definizione della classe, cioè al caricamento.
function isDeferredInitializer(node) {
  return node.type === "PropertyDefinition" && node.static !== true;
}

// Violazioni del contratto nel sorgente. Un sorgente che non si riesce ad analizzare non è
// conforme per questo: lo si dichiara, invece di restituire un elenco vuoto che sembrerebbe un
// esito positivo. (Se è un vero errore di sintassi, il chiamante ha già l'errore di compilazione
// e non arriva fin qui.)
function findContractViolations(source) {
  let program;
  try {
    program = parseScript(source);
  } catch (error) {
    return [{
      code: "SCRIPT_CONTRACT_NOT_ANALYZED",
      message: `The script contract could not be checked for this file: the parser rejected it (${String(error.message).replace(/ \(\d+:\d+\)$/, "")}). It is not certified as compliant.`,
    }];
  }

  const violations = [];
  const visit = (node, insideFunction) => {
    if (node == null || typeof node.type !== "string") {
      return;
    }

    if (isRequireCall(node)) {
      const specifier = literalSpecifier(node.arguments[0]);
      if (specifier == null) {
        violations.push(violation(
          "SCRIPT_DYNAMIC_REQUIRE",
          node,
          "require() with a computed path: local dependencies must be imported with a literal path, so the engine and the validator know them"
        ));
      } else if (isLocalSpecifier(specifier)) {
        if (insideFunction) {
          violations.push(violation(
            "SCRIPT_LATE_REQUIRE",
            node,
            `require("${specifier}") runs inside a function: import local dependencies at the top of the module, or after a reload the function gets new code in the middle of a request`
          ));
        }
        if (path.extname(specifier) === ".mjs") {
          violations.push(violation(
            "SCRIPT_ESM_DEPENDENCY",
            node,
            `require("${specifier}") loads a local ES module: mock scripts and their helpers are CommonJS, and Node never reloads a local ES module, so its changes need a restart`
          ));
        }
        if (!specifier.startsWith("#") && path.extname(specifier) === "") {
          violations.push(violation(
            "SCRIPT_REQUIRE_WITHOUT_EXTENSION",
            node,
            `require("${specifier}") has no extension: write the full file name (for example "${specifier}.js"), so the path cannot resolve to a different file after a reload`
          ));
        }
      }
    } else if (node.type === "ImportExpression") {
      const specifier = literalSpecifier(node.source);
      if (specifier == null || isLocalSpecifier(specifier)) {
        violations.push(violation(
          "SCRIPT_LOCAL_DYNAMIC_IMPORT",
          node,
          "import() of local code: mock scripts are CommonJS and local ES modules are not reloaded; use require() at the top of the module"
        ));
      }
    }

    const nested = insideFunction || FUNCTION_NODES.has(node.type);
    const deferredInitializer = isDeferredInitializer(node);
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) {
        continue;
      }
      const child = node[key];
      if (deferredInitializer && key === "value") {
        visit(child, true);
        continue;
      }
      if (Array.isArray(child)) {
        for (const item of child) {
          visit(item, nested);
        }
      } else if (child != null && typeof child === "object") {
        visit(child, nested);
      }
    }
  };
  visit(program, false);

  return violations.sort((left, right) => left.line - right.line || left.column - right.column);
}

module.exports = {
  findContractViolations,
};
