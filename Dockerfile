FROM node:22-bookworm-slim

# Chromium sistem + font (emoji/teks) untuk whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public

# Sesi WhatsApp disimpan di volume agar tidak perlu scan QR ulang setelah restart/update
VOLUME ["/app/.wwebjs_auth"]
EXPOSE 3000
CMD ["node", "src/index.js"]
