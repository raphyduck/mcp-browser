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

# MCP runs on stdio — start the server
CMD ["node", "dist/index.js"]
