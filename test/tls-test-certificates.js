const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * Certificati di prova generati al momento, per i test del backend in https.
 *
 * Nel repository non entrano chiavi né certificati (`.gitignore` esclude `*.key` e `*.pem`), e
 * i test non possono contare su `openssl` nel PATH: qui una CA privata e un certificato server
 * per `localhost` / `127.0.0.1` si costruiscono con il solo modulo crypto di Node, scrivendo a
 * mano il DER di un certificato X.509 v3 firmato ECDSA P-256. Nessun archivio conosce questa
 * CA: è proprio il caso che i test devono riprodurre.
 */

// --- DER: quanto basta per un certificato ---

function derLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  for (let rest = length; rest > 0; rest >>= 8) {
    bytes.unshift(rest & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts) => der(0x30, ...parts);
const set = (...parts) => der(0x31, ...parts);
const octetString = (content) => der(0x04, content);
const bitString = (content, unusedBits = 0) => der(0x03, Buffer.from([unusedBits]), content);
const utf8String = (text) => der(0x0c, Buffer.from(text, "utf8"));
const booleanTrue = () => der(0x01, Buffer.from([0xff]));

// Intero positivo: uno zero davanti quando il primo bit lo farebbe leggere come negativo.
function integer(bytes) {
  const content = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  return der(0x02, content);
}

function oid(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) {
      chunk.unshift((value & 0x7f) | 0x80);
    }
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

// UTCTime fino al 2049, GeneralizedTime dopo (RFC 5280 §4.1.2.5).
function time(date) {
  const stamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return date.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(`${stamp.slice(2)}Z`, "ascii"))
    : der(0x18, Buffer.from(`${stamp}Z`, "ascii"));
}

const commonName = (name) => sequence(set(sequence(oid("2.5.4.3"), utf8String(name))));

function extension(id, critical, value) {
  return sequence(oid(id), ...(critical ? [booleanTrue()] : []), octetString(value));
}

const ECDSA_WITH_SHA256 = sequence(oid("1.2.840.10045.4.3.2"));

function pem(label, content) {
  const body = content.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

// Certificato X.509 v3: `subjectKey` è la chiave pubblica certificata, `issuerKey` firma.
function buildCertificate({ subject, issuer, subjectKey, issuerKey, extensions }) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const tbsCertificate = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(crypto.randomBytes(8)),
    ECDSA_WITH_SHA256,
    commonName(issuer),
    sequence(time(new Date(now - day)), time(new Date(now + 30 * day))),
    commonName(subject),
    subjectKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(...extensions))
  );
  const signature = crypto.sign("sha256", tbsCertificate, issuerKey);
  return pem("CERTIFICATE", sequence(tbsCertificate, ECDSA_WITH_SHA256, bitString(signature)));
}

// Una CA privata e un certificato server firmato da lei, in PEM.
function createTestCertificates() {
  const newKeyPair = () => crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const authority = newKeyPair();
  const server = newKeyPair();

  const ca = buildCertificate({
    subject: "Mockxy test CA",
    issuer: "Mockxy test CA",
    subjectKey: authority.publicKey,
    issuerKey: authority.privateKey,
    extensions: [
      // basicConstraints: CA
      extension("2.5.29.19", true, sequence(booleanTrue())),
      // keyUsage: keyCertSign, cRLSign
      extension("2.5.29.15", true, bitString(Buffer.from([0x06]), 1)),
    ],
  });
  const cert = buildCertificate({
    subject: "localhost",
    issuer: "Mockxy test CA",
    subjectKey: server.publicKey,
    issuerKey: authority.privateKey,
    extensions: [
      // subjectAltName: DNS:localhost, IP:127.0.0.1
      extension(
        "2.5.29.17",
        false,
        sequence(der(0x82, Buffer.from("localhost", "ascii")), der(0x87, Buffer.from([127, 0, 0, 1])))
      ),
      // keyUsage: digitalSignature
      extension("2.5.29.15", true, bitString(Buffer.from([0x80]), 7)),
      // extendedKeyUsage: serverAuth
      extension("2.5.29.37", false, sequence(oid("1.3.6.1.5.5.7.3.1"))),
    ],
  });
  // La chiave della CA non esce da qui: firmato il certificato server, non serve più.
  return { ca, cert, key: server.privateKey.export({ type: "pkcs8", format: "pem" }) };
}

// Scrive i tre file in una cartella (temporanea, del test) e ne restituisce i percorsi: servono
// su disco al processo figlio e alle variabili d'ambiente che indicano una CA per file.
function writeTestCertificates(directory) {
  const certificates = createTestCertificates();
  const files = {
    caFile: path.join(directory, "ca.pem"),
    certFile: path.join(directory, "server.pem"),
    keyFile: path.join(directory, "server.key"),
  };
  fs.writeFileSync(files.caFile, certificates.ca);
  fs.writeFileSync(files.certFile, certificates.cert);
  fs.writeFileSync(files.keyFile, certificates.key);
  return { ...certificates, ...files };
}

module.exports = { createTestCertificates, writeTestCertificates };
