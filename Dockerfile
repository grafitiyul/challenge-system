FROM node:22

WORKDIR /app

COPY . .

RUN npm install

RUN npm run build --workspace=@challenge-system/web

CMD ["npm", "run", "start", "--workspace=@challenge-system/web"]