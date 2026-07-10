// Completamento per gli script handler/middleware (mostrato solo in modalità JavaScript).
//
// Offre scorciatoie allo scheletro del contratto e ai campi della risposta, allineate ai template
// che l'app già genera: handler → resolveResponse, middleware → transformResponse, entrambi tornano
// { status, headers, jsonBody }. I `\${}` sono i punti dove si posiziona il cursore dopo l'inserimento.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';

const HANDLER_SNIPPET = `module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody }) {
    return {
      status: 200,
      headers: {},
      jsonBody: \${}
    };
  }
};`;

const MIDDLEWARE_SNIPPET = `module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers },
      jsonBody: { ...jsonBody, \${} }
    };
  }
};`;

const RESOLVE_SNIPPET = `async resolveResponse({ params, query, requestHeaders, jsonBody }) {
  return {
    status: 200,
    headers: {},
    jsonBody: \${}
  };
}`;

const TRANSFORM_SNIPPET = `async transformResponse({ status, headers, jsonBody }) {
  return {
    status,
    headers: { ...headers },
    jsonBody: { ...jsonBody, \${} }
  };
}`;

const SCRIPT_COMPLETIONS: readonly Completion[] = [
  snippetCompletion(HANDLER_SNIPPET, {
    label: 'handler',
    type: 'interface',
    detail: 'scheletro',
    info: 'module.exports con resolveResponse',
  }),
  snippetCompletion(MIDDLEWARE_SNIPPET, {
    label: 'middleware',
    type: 'interface',
    detail: 'scheletro',
    info: 'module.exports con transformResponse',
  }),
  snippetCompletion(RESOLVE_SNIPPET, { label: 'resolveResponse', type: 'method', detail: 'handler' }),
  snippetCompletion(TRANSFORM_SNIPPET, { label: 'transformResponse', type: 'method', detail: 'middleware' }),
  snippetCompletion('status: \${}', { label: 'status', type: 'property', detail: 'campo risposta' }),
  snippetCompletion('headers: { \${} }', { label: 'headers', type: 'property', detail: 'campo risposta' }),
  snippetCompletion('jsonBody: \${}', { label: 'jsonBody', type: 'property', detail: 'campo risposta' }),
  { label: 'params', type: 'variable', detail: 'input richiesta' },
  { label: 'query', type: 'variable', detail: 'input richiesta' },
  { label: 'requestHeaders', type: 'variable', detail: 'input richiesta' },
];

// Sorgente di completamento: si attiva mentre si digita una parola (o su richiesta esplicita,
// Ctrl+Space), e filtra le voci in base al prefisso.
export function scriptCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$]*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }
  return { from: word.from, options: [...SCRIPT_COMPLETIONS], validFor: /^[\w$]*$/ };
}
