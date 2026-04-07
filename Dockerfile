FROM node:22

WORKDIR /app

COPY . .

RUN npm install

# API_URL must be set at BUILD TIME — Next.js bakes rewrites() into routes-manifest.json
# during `next build`. Setting it only as a runtime variable has no effect.
#
# In Railway: set API_URL=https://<your-api-service>.up.railway.app in the web service
# Variables. Railway automatically forwards all Variables as Docker build ARGs.
ARG API_URL=http://localhost:3001
ENV API_URL=$API_URL

RUN npm run build --workspace=@challenge-system/web

CMD ["npm", "run", "start", "--workspace=@challenge-system/web"]
