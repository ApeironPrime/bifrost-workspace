FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate && npm run build

EXPOSE 3000

CMD ["npm", "start"]
