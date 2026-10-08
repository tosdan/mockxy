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

function parseScript(source) {
  // CommonJS come lo compila Node: `return` ammesso a livello di modulo, hashbang tollerato.
  return acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowHashBang: true,
    locations: true,
  });
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
  return { code, line: node.loc.start.line, column: node.loc.start.column + 1, message };
}

// Violazioni del contratto nel sorgente. Un sorgente che non si analizza non ne produce: il suo
// errore di sintassi è già l'errore di compilazione.
function findContractViolations(source) {
  let program;
  try {
    program = parseScript(source);
  } catch (_error) {
    return [];
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
    for (const key of Object.keys(node)) {
      if (SKIPPED_KEYS.has(key)) {
        continue;
      }
      const child = node[key];
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
