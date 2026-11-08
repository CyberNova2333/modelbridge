FROM node:24-bookworm-slim
WORKDIR /app
# This service uses only Node built-ins. Package managers are build/development
# tools, not runtime dependencies; omit their separate dependency trees.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && mkdir -p /data && chown node:node /data && chmod 700 /data
COPY --chown=node:node package.json _worker.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node tools ./tools
USER node
ENV HOST=0.0.0.0 PORT=8788 DB_PATH=/data/modelbridge.sqlite
EXPOSE 8788
CMD ["node", "src/self-hosted/server.mjs"]
