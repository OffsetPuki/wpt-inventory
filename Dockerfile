# Flipnob Business Suite — single-process Node server (API + built client).
FROM node:22-bookworm-slim

# Python powers the optional AI "Identify by photo" helper (server/identify_item.py).
# ca-certificates is required so Python's HTTPS call to the Anthropic API can
# verify SSL certificates (otherwise: CERTIFICATE_VERIFY_FAILED).
# build-essential (make + g++) lets better-sqlite3 compile from source when its
# prebuilt binary download flakes — without it the slim image has no compiler
# and `npm ci` fails intermittently with node-gyp errors.
# tzdata ships the zoneinfo files TZ below needs. The slim image doesn't carry
# them, and without them Node silently ignores TZ and stays on UTC — which is
# the whole bug this is here to fix, failing in exactly the way that looks like
# it worked.
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential ca-certificates tzdata \
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
# The shop's clock. Without this the container runs UTC, which put the daily
# digest in the owner's inbox at 1-2am (it fires on getHours() < 7) and, from
# 7pm to midnight local, dated invoices, expenses and payroll a day forward —
# sometimes into the next month, moving money on the P&L. A Railway variable of
# the same name overrides this if the shop ever moves.
ENV TZ=America/Chicago

EXPOSE 5000
CMD ["node", "dist/index.cjs"]
