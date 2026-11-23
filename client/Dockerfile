FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./
ARG VITE_DATA_MODE=api
ARG VITE_API_URL=/api
ARG VITE_SIGNALING_URL=/
ENV VITE_DATA_MODE=${VITE_DATA_MODE}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SIGNALING_URL=${VITE_SIGNALING_URL}
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
