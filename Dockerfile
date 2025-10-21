# Use Playwright image with all browsers & deps
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npx playwright install chromium

COPY . .
EXPOSE 3000
CMD ["npm", "start"]
