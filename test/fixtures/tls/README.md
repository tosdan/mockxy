# Certificati di prova

Usati da `test/backend-tls.test.js` per un backend https che nessun archivio conosce.

- `ca.pem` — una CA privata («Mockxy test CA»). La sua chiave non è conservata: non può
  firmare altro.
- `server.pem`, `server.key` — certificato e chiave di un server per `localhost` e `127.0.0.1`,
  firmati da quella CA. La chiave è in chiaro di proposito: vale solo per questi test.

Validi fino al 2126. Per rigenerarli:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=Mockxy test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -keyout ca.key -out ca.pem
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout server.key -out server.csr
printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 36500 -extfile ext.cnf -out server.pem
rm ca.key server.csr ext.cnf ca.srl
```
