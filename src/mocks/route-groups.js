const { match } = require("path-to-regexp");
const RESERVED_QUERY_FOLDER_CHAR = "^";

// Splits a declared route into pathname and raw query string so matching can treat them separately.
function splitRoutePath(routePath) {
  const queryStartIndex = routePath.indexOf("?");
  return {
    pathname: queryStartIndex === -1 ? routePath : routePath.slice(0, queryStartIndex),
    queryString: queryStartIndex === -1 ? "" : routePath.slice(queryStartIndex + 1),
  };
}

// Reads the raw query string from the incoming request URL when one is available.
function readRequestQueryString(requestUrl) {
  if (typeof requestUrl !== "string") {
    return "";
  }

  const queryStartIndex = requestUrl.indexOf("?");
  return queryStartIndex === -1 ? "" : requestUrl.slice(queryStartIndex + 1);
}

// Normalizes query parameters so matching is stable even when the request changes parameter order.
function toSortedQueryEntries(queryString) {
  return Array.from(new URLSearchParams(queryString).entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyCompare = leftKey.localeCompare(rightKey);
      if (keyCompare !== 0) {
        return keyCompare;
      }

      return leftValue.localeCompare(rightValue);
    });
}

// Checks whether a route's declared query string exactly matches the incoming request query.
function matchesRequiredQuery(routeQueryString, requestUrl) {
  if (routeQueryString === "") {
    return true;
  }

  const expectedEntries = toSortedQueryEntries(routeQueryString);
  const actualEntries = toSortedQueryEntries(readRequestQueryString(requestUrl));
  if (expectedEntries.length !== actualEntries.length) {
    return false;
  }

  return expectedEntries.every(([expectedKey, expectedValue], index) => {
    const [actualKey, actualValue] = actualEntries[index];
    return actualKey === expectedKey && actualValue === expectedValue;
  });
}

// Returns true when a route path contains path-to-regexp tokens and needs dynamic matching.
function isDynamicPath(routePath) {
  return /[:*]/.test(splitRoutePath(routePath).pathname);
}

// Counts static path segments so more specific dynamic routes can be sorted first.
function countStaticSegments(routePath) {
  return splitRoutePath(routePath).pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(":") && segment !== "*").length;
}

// Validates that declared route paths always use an absolute API path.
function validatePathFormat(routePath, filePath, label = "Route path") {
  const { pathname } = splitRoutePath(routePath);

  if (!pathname.startsWith("/")) {
    throw new Error(`${label} must start with '/' in ${filePath}. Received: ${routePath}`);
  }

  if (routePath.includes(RESERVED_QUERY_FOLDER_CHAR)) {
    throw new Error(
      `${label} cannot contain '${RESERVED_QUERY_FOLDER_CHAR}' because it is reserved for derived query folders.`
    );
  }
}

// Builds a deterministic matcher for exact and dynamic route definitions, including query matching.
function createPathMatcher(routePath, filePath) {
  const { pathname, queryString } = splitRoutePath(routePath);
  const dynamic = isDynamicPath(pathname);
  if (!dynamic) {
    return {
      dynamic,
      fn: (requestPath, requestUrl) => {
        return requestPath === pathname && matchesRequiredQuery(queryString, requestUrl);
      },
    };
  }

  try {
    const matcher = match(pathname, { decode: decodeURIComponent, end: true });
    return {
      dynamic,
      fn: (requestPath, requestUrl) => {
        return Boolean(matcher(requestPath)) && matchesRequiredQuery(queryString, requestUrl);
      },
    };
  } catch (error) {
    throw new Error(`Invalid path pattern in ${filePath}: ${routePath}. ${error.message}`);
  }
}

// Builds a matcher that also exposes extracted params for routes that need request context.
function createPathParamsMatcher(routePath, filePath) {
  const { pathname, queryString } = splitRoutePath(routePath);
  const dynamic = isDynamicPath(pathname);
  if (!dynamic) {
    return {
      dynamic,
      fn: (requestPath, requestUrl) => {
        if (requestPath !== pathname || !matchesRequiredQuery(queryString, requestUrl)) {
          return false;
        }

        return { params: {} };
      },
    };
  }

  try {
    const matcher = match(pathname, { decode: decodeURIComponent, end: true });
    return {
      dynamic,
      fn: (requestPath, requestUrl) => {
        if (!matchesRequiredQuery(queryString, requestUrl)) {
          return false;
        }

        return matcher(requestPath) || false;
      },
    };
  } catch (error) {
    throw new Error(`Invalid path pattern in ${filePath}: ${routePath}. ${error.message}`);
  }
}

// Returns true when a route declares a required query string, which makes it more specific than the
// same pathname without one.
function hasRequiredQuery(routePath) {
  return splitRoutePath(routePath).queryString !== "";
}

// Orders route groups so exact matches win over dynamic ones and the most specific path wins first.
function sortRouteGroups(groups) {
  return groups.sort((a, b) => {
    if (a.dynamic !== b.dynamic) {
      return a.dynamic ? 1 : -1;
    }

    if (a.dynamic && b.dynamic && a.staticSegments !== b.staticSegments) {
      return b.staticSegments - a.staticSegments;
    }

    // A route requiring a query string is more specific than its query-less sibling on the same
    // pathname and must be tried first; otherwise the query-less route (which matches any query)
    // could shadow it. Making this explicit avoids relying on the '^' query-folder character
    // happening to sort before method file names in sortKey.
    const aHasQuery = hasRequiredQuery(a.path);
    const bHasQuery = hasRequiredQuery(b.path);
    if (aHasQuery !== bHasQuery) {
      return aHasQuery ? -1 : 1;
    }

    return a.sortKey.localeCompare(b.sortKey);
  });
}

module.exports = {
  countStaticSegments,
  createPathMatcher,
  createPathParamsMatcher,
  isDynamicPath,
  sortRouteGroups,
  validatePathFormat,
};