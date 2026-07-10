function setNoCacheHeaders(response) {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
}

module.exports = {
  setNoCacheHeaders,
};
