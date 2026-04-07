FROM node:22

WORKDIR /app

COPY . .

RUN npm install

# NEXT_PUBLIC_* variables are baked into the bundle at build time.
# Railway must pass NEXT_PUBLIC_API_URL as a build variable (not just a runtime variable).
# In Railway dashboard → web service → Variables → add NEXT_PUBLIC_API_URL=<your-api-url>
# Railway automatically forwards all service Variables as Docker build args.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace=@challenge-system/web

CMD ["npm", "run", "start", "--workspace=@challenge-system/web"]