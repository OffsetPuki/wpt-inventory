# WPT Inventory Locator — single-process Node server (API + built client).
FROM node:22-bookworm-slim

# Python powers the optional AI "Identify by photo" helper (server/identify_item.py).
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
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
