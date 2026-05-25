# WPT Inventory Locator — single-process Node server (API + built client).
FROM node:22-bookworm-slim

# Python powers the optional AI "Identify by photo" helper (server/identify_item.py).
# ca-certificates is required so Python's HTTPS call to the Anthropic API can
# verify SSL certificates (otherwise: CERTIFICATE_VERIFY_FAILED).
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better Docker layer caching).
COPY package*.json ./
RUN npm ci

# Copy the source and build the client + server bundle.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=5000
ENV DATA_DIR=/data
ENV PYTHON_BIN=python3

EXPOSE 5000
CMD ["node", "dist/index.cjs"]
