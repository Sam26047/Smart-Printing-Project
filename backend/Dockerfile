FROM node:20

WORKDIR /app

COPY package.json .
RUN npm install
#becuse if we do copy .. then run npm

COPY . .

CMD ["npm","start"]