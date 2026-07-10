FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Dentro un container il bind deve essere 0.0.0.0: il loopback del container non è
# raggiungibile dal port mapping. L'esposizione reale si decide a livello host
# (es. "-p 127.0.0.1:3000:3000" per restare solo locali).
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
