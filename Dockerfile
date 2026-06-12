# nostr-ops-mcp — container image for Glama's introspection check (stdio MCP server).
#
# Glama starts this image and sends MCP `initialize` + `tools/list` over stdio; the
# server must start and respond. NOSTR_RELAYS (a PUBLIC relay list, not a secret) is
# required for config to validate — with it set and no signer configured, the server
# runs in read-only mode and lists all tools. No secrets are needed for introspection.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Public relays so config validates; read-only mode (no signer) is enough to introspect.
ENV NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol"
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
