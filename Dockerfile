FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p data backups relatorios && chown -R node:node /app
USER node

EXPOSE 8787
CMD ["node", "src/api.js"]
