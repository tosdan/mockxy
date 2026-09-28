const { AsyncLocalStorage } = require("async_hooks");
const path = require("path");

// Tracciamento esplicito dei file scritti da un'operazione (piano agent/API, §13 C2): ogni
// mutazione API esegue il proprio gestore dentro un contesto che raccoglie i percorsi scritti,
// così la revisione del catalogo rilegge proprio quei file anche se dimensione e mtime non
// cambiano. Il contesto segue le promise dell'operazione, reload compreso.
const storage = new AsyncLocalStorage();

function trackWrites(written, task) {
  return storage.run(written, task);
}

// Da chiamare in ogni punto che scrive contenuto su un file; fuori da un contesto non fa nulla.
function recordWrite(filePath) {
  const written = storage.getStore();
  if (written != null) {
    written.add(path.resolve(filePath));
  }
}

module.exports = {
  recordWrite,
  trackWrites,
};
