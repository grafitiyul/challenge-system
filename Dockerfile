FROM node:22

WORKDIR /app

COPY . .

RUN npm install

# Build both API and web
RUN npm run build --workspace=@challenge-system/api
RUN npm run build --workspace=@challenge-system/web

# Start API on port 3001 (API_PORT), then web on Railway's assigned PORT.
# API_URL tells Next.js rewrites where to proxy /api-proxy/* requests.
# Set API_PORT=3001 and API_URL=http://localhost:3001 in Railway Variables.
CMD sh -c "API_PORT=${API_PORT:-3001} npm run start --workspace=@challenge-system/api & sleep 5 && npm run start --workspace=@challenge-system/web"
