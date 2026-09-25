# Use official Node.js LTS image
FROM node:20-alpine

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
