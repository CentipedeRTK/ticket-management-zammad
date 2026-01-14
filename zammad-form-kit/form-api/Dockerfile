FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js ./
COPY lib ./lib
COPY assets ./assets
EXPOSE 3000
CMD ["node", "server.js"]
