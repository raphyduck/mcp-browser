FROM node:20-slim

WORKDIR /app

# Install Node deps
COPY package.json ./
RUN npm install

# Install Chromium
RUN npx playwright install chromium --with-deps

# Copy source and compile TypeScript (ignore node_modules errors)
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc --skipLibCheck 2>&1 | grep -v "node_modules" || true && test -f dist/index.js

# Drop devDeps
RUN npm prune --omit=dev

# Installer capsolver APRES la compilation
RUN npm install @captcha-libs/capsolver --no-save

VOLUME ["/app/profile"]

ENV HEADLESS=true
ENV SLOW_MO=0
ENV BROWSER_TIMEOUT=30000
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000
ENV MCP_AUTH_TOKEN=

EXPOSE 3000

CMD ["node", "dist/index.js"]
