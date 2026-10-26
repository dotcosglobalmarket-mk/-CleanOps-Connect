# Debian-based (not alpine): alpine's musl libc has a long-documented history
# of flaky/timeout-prone DNS resolution for outbound HTTPS calls in
# containerized cloud environments, which shows up as Stripe's SDK reporting
# "An error occurred with our connection to Stripe" after exhausting its
# retries even though the API key and network egress are otherwise fine.
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy the rest of the application
COPY . .

# Expose the port (DigitalOcean will map this automatically)
EXPOSE 4000

# Start the server
CMD ["npm", "start"]
