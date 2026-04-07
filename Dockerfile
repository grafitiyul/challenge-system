FROM node:22

WORKDIR /app

COPY . .

RUN npm install

RUN npm run build --workspace=@challenge-system/web

# API_URL is a server-side runtime variable set in Railway Variables.
# It tells Next.js rewrites where to proxy /api-proxy/* requests.
# Set it to your Railway API service URL, e.g.:
#   API_URL=https://your-api-service.up.railway.app
# or the Railway internal URL if both services are in the same project:
#   API_URL=http://api.railway.internal:PORT
CMD ["npm", "run", "start", "--workspace=@challenge-system/web"]
