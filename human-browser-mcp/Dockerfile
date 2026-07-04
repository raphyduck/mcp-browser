FROM node:20-slim

WORKDIR /app

# Install Node deps
COPY package.json ./
RUN npm install

# Install Chromium
RUN npx playwright install chromium --with-deps

# Chromium patché de patchright (corrige les fuites CDP Runtime.enable exploitées par Cloudflare)
RUN npx patchright install chromium

# Google Chrome stable : vrai navigateur (fingerprint authentique) pour patchright channel:chrome.
# C'est le combo de reference pour passer les challenges manages Cloudflare.
RUN apt-get update && apt-get install -y --no-install-recommends wget gnupg ca-certificates \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && (apt-get install -y --no-install-recommends /tmp/chrome.deb || (apt-get -f install -y && apt-get install -y --no-install-recommends /tmp/chrome.deb)) \
    && rm -f /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*

# Xvfb : permet de lancer Chromium en mode 'headed' (headless=false) dans le conteneur,
# ce qui reduit fortement la detection anti-bot (Cloudflare, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth && rm -rf /var/lib/apt/lists/*

# Copy source and compile TypeScript (ignore node_modules errors)
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc --skipLibCheck 2>&1 | grep -v "node_modules" || true && test -f dist/index.js

# Drop devDeps
RUN npm prune --omit=dev

# Installer capsolver APRES la compilation
RUN npm install @captcha-libs/capsolver --no-save

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

VOLUME ["/app/profile"]

ENV HEADLESS=false
ENV SLOW_MO=0
ENV BROWSER_TIMEOUT=30000
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000
ENV MCP_AUTH_TOKEN=

EXPOSE 3000

CMD ["/app/entrypoint.sh"]
