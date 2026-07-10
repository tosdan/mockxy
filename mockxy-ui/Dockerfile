FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

EXPOSE 4207

CMD ["npm", "run", "start:docker"]
