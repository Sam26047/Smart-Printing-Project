#start with a node container ,call this stage "build"
FROM node:20 AS build 

WORKDIR /app
 
COPY package.json .
RUN npm install
COPY . .
RUN npm run build 
#This runs Vite's build command which compiles your React code into plain HTML/CSS/JS files and puts them in a /app/dist folder. These are static files — no Node needed to serve them.npm run dev is for development, it starts a dev server with hot reloading, but for production we want to build the static files and serve them with nginx.

#now start a fresh container with just nginx (lightweight web server),thid is called multi-stage build- the first stage builds,the second stage serves the built files.the final image doesnt contain node at all making it much smaller
FROM nginx:alpine

#Copy the built files from the first stage into nginx's serving folder. Nginx will serve whatever is in /usr/share/nginx/html.
COPY --from=build /app/dist /usr/share/nginx/html

#tell docker this container will listen on port 80 (standard port for http, the default port for nginx listening)
EXPOSE 80