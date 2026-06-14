FROM node:20-slim

# Install system dependencies required by Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install Node dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Install Chromium via Playwright
RUN npx playwright install chromium --with-deps

# Copy compiled sources (build before Docker build, or compile here)
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install --save-dev typescript @types/node \
    && npx tsc \
    && npm prune --omit=dev

# Persistent browser profile volume
VOLUME ["/app/profile"]

ENV HEADLESS=true
ENV SLOW_MO=0
ENV BROWSER_TIMEOUT=30000

CMD ["node", "dist/index.js"]
