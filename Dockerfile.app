# app.tzortzoglou.eu — the signed-in app.
#
# Two stages so the build toolchain never reaches the running container: the final image is
# nginx plus a directory of static files, with no Node, no npm and no source.
#
# nginx rather than serving this from the API, for one reason that earns its keep: it can set
# real response headers. The public site is on GitHub Pages and is stuck with a <meta> CSP,
# which cannot express frame-ancestors - so the one page worth protecting from clickjacking is
# the one that cannot be. Here it can.
FROM node:22-alpine AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:app

FROM nginx:alpine
COPY --from=build /build/_app /usr/share/nginx/html
COPY nginx.app.conf /etc/nginx/conf.d/default.conf
COPY nginx.app.headers.conf /etc/nginx/snippets/security.conf
# Runs before nginx starts; see the script for why the config is generated rather than baked.
COPY docker/10-firebase-config.sh /docker-entrypoint.d/10-firebase-config.sh
EXPOSE 80
