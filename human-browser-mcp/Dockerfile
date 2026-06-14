FROM node:20-slim

WORKDIR /app

# Install all Node deps (devDeps needed for tsc)
COPY package.json ./
RUN npm install

# Install Chromium + all system libraries (playwright handles apt internally)
RUN npx playwright install chromium --with-deps

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Drop devDeps from final image
RUN npm prune --production

# Persistent browser profile volume
VOLUME ["/app/profile"]

ENV HEADLESS=true
ENV SLOW_MO=0
ENV BROWSER_TIMEOUT=30000
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000
ENV MCP_AUTH_TOKEN=

EXPOSE 3000

# MCP runs on stdio by default; set MCP_TRANSPORT=http for HTTP/SSE mode
CMD ["node", "dist/index.js"]
