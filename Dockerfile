FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    ECHO_HOST=0.0.0.0 \
    ECHO_PORT=4173 \
    ECHO_DATA_DIR=/data
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/lib ./lib
COPY --from=build /app/db ./db
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
CMD ["npm", "start"]
