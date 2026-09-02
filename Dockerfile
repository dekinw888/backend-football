# Use an image that includes the OS dependencies Playwright needs for browser automation.
FROM node:20-bookworm-slim

WORKDIR /usr/src/app

# Install app dependencies.
COPY package*.json ./
RUN npm ci --only=production

# Install Chromium for the goal7.co result scraper.
RUN npx playwright install --with-deps chromium

# Bundle app source.
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "src/server.js"]
