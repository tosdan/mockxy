const { createAdminError } = require("./admin-errors");

// Mappa una route path nel layout a cartelle del workspace mock: un segmento-cartella per ogni
// segmento del path (i parametri :nome diventano {nome}), più un segmento "^..." per la query string.

const REGULAR_FOLDER_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const PARAM_FOLDER_SEGMENT_PATTERN = /^\{[A-Za-z0-9_]+\}$/;
const QUERY_FOLDER_SEGMENT_PATTERN = /^\^[A-Za-z0-9._-]+(?:_[A-Za-z0-9._-]+)*$/;

function isSupportedFolderSegment(segment) {
  const isSpecialRelativeSegment = segment === "." || segment === "..";
  if (isSpecialRelativeSegment) {
    return false;
  }

  return REGULAR_FOLDER_SEGMENT_PATTERN.test(segment)
    || PARAM_FOLDER_SEGMENT_PATTERN.test(segment)
    || QUERY_FOLDER_SEGMENT_PATTERN.test(segment);
}

function deriveFolderSegmentFromRouteSegment(routeSegment, fieldName) {
  if (!routeSegment.startsWith(":")) {
    if (!isSupportedFolderSegment(routeSegment)) {
      throw createAdminError(
        400,
        `${fieldName} contains a segment that cannot be converted to a folder name: ${routeSegment}.`
      );
    }

    return routeSegment;
  }

  const parameterName = routeSegment.slice(1);
  if (!/^[A-Za-z0-9_]+$/.test(parameterName)) {
    throw createAdminError(
      400,
      `${fieldName} contains a dynamic segment that cannot be converted to a folder name: ${routeSegment}.`
    );
  }

  return `{${parameterName}}`;
}

function deriveFolderPathFromRoutePath(routePath, fieldName) {
  const queryStartIndex = routePath.indexOf("?");
  const pathPortion = queryStartIndex === -1 ? routePath : routePath.slice(0, queryStartIndex);
  const queryString = queryStartIndex === -1 ? "" : routePath.slice(queryStartIndex + 1);
  const pathSegments = pathPortion.split("/").filter((segment) => segment !== "");
  const derivedSegments = pathSegments.map((segment) => deriveFolderSegmentFromRouteSegment(segment, fieldName));

  if (queryString !== "") {
    const queryFolderSegment = `^${queryString.replaceAll("&", "_").replaceAll("=", "-")}`;
    if (!isSupportedFolderSegment(queryFolderSegment)) {
      throw createAdminError(
        400,
        `${fieldName} contains a query string that cannot be converted to a folder name.`
      );
    }

    derivedSegments.push(queryFolderSegment);
  }

  return derivedSegments.join("/");
}

module.exports = {
  deriveFolderPathFromRoutePath,
};
