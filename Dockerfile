# Glama (and anyone) can run the stdio server in a container. Zero runtime
# dependencies: no npm install, just node and the sources.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
ENV NODE_ENV=production
ENTRYPOINT ["node", "bin/serpdive-mcp.js"]
