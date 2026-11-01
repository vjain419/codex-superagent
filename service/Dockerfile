FROM node:24-bookworm-slim
ARG CODEX_VERSION=0.166.0
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm install --registry=${NPM_REGISTRY} --global --ignore-scripts @openai/codex@${CODEX_VERSION} \
    && mkdir -p /data /repos && chown node:node /data /repos
WORKDIR /app
COPY service/package.json service/package-lock.json ./
RUN npm ci --registry=${NPM_REGISTRY} --omit=dev --ignore-scripts && npm cache clean --force
COPY service/ ./
RUN chmod -R a+rX /app
USER node
ENV SUPERAGENT_CONFIG=/data/config.json
EXPOSE 3082
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3082/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--env-file=/data/service.env","main.mjs"]
