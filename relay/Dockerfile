FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY apns-client.js push-service.js relay.js server.js ./

EXPOSE 9000

CMD ["npm", "start"]
