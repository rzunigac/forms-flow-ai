# The web container: root-config, every micro-frontend bundle and the base theme, served by nginx
# from the page's own origin (report 08, analysis 20). Build context is the repo root.
#
# MFE_BUNDLES: the bundles image from the micro-front-ends fork, by digest. build.sh passes the
# pinned value in forms-flow-web-root-config/mfe-bundles.ref.
ARG MFE_BUNDLES
FROM ${MFE_BUNDLES} AS mfe-bundles

# --- forms-flow-web micro-frontend (@formsflow/formsflow-web), from this repo -------------------
FROM node:18.20.0-alpine AS web-bundle
# build.sh --no-cache sets CACHE_ID to start from an empty npm cache.
ARG CACHE_ID=shared
WORKDIR /forms-flow-web
COPY forms-flow-web/package.json forms-flow-web/package-lock.json ./
# Retries: npm ci downloads ~2000 packages, and one timeout would fail the build.
RUN --mount=type=cache,id=ff-npm-$CACHE_ID,target=/root/.npm \
    npm config set fetch-retries 6 && npm config set fetch-retry-maxtimeout 120000 && \
    npm ci --no-audit --no-fund --loglevel=error
COPY forms-flow-web ./
RUN npm run build && test -f build/forms-flow-web.js

# --- third-party browser assets (/vendor/), from npm tarballs pinned in vendor/packages.txt ---
FROM node:18.20.0-alpine AS vendor
ARG CACHE_ID=shared
WORKDIR /vendor
COPY forms-flow-web-root-config/vendor/ forms-flow-web-root-config/src/index.ejs ./
RUN --mount=type=cache,id=ff-npm-$CACHE_ID,target=/root/.npm \
    npm config set fetch-retries 6 && npm config set fetch-retry-maxtimeout 120000 && \
    node vendor.js index.ejs packages.txt /out/vendor

# --- root-config ----------------------------------------------------------------------------
FROM node:18.20.0-alpine AS build-stage

WORKDIR /forms-flow-web-root-config/app

ARG CACHE_ID=shared
ARG NODE_ENV
ENV NODE_ENV ${NODE_ENV}

# Add `/app/node_modules/.bin` to $PATH
ENV PATH /forms-flow-web-root-config/app/node_modules/.bin:$PATH

# Install and cache app dependencies
COPY forms-flow-web-root-config/package-lock.json forms-flow-web-root-config/package.json ./
RUN --mount=type=cache,id=ff-npm-$CACHE_ID,target=/root/.npm npm ci --omit=dev

# Copy source code
COPY forms-flow-web-root-config ./

# Build the application
RUN if [ "$NODE_ENV" = "development" ]; then \
        npm run build-dev:webpack; \
    else \
        npm run build:webpack; \
    fi

# --- production -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS production-stage

LABEL Name="formsflow"

# jq writes the import map; bash runs the legacy env.sh (chart postStart hooks still call it).
RUN apk add --no-cache bash jq

WORKDIR /usr/share/nginx/html/config

COPY --from=build-stage /forms-flow-web-root-config/app/dist /usr/share/nginx/html
COPY --from=mfe-bundles /mfe /usr/share/nginx/html/mfe
# The bundle plus the chunks it loads on demand (static/). Upstream uploads forms-flow-web.js only,
# so on AOT's CDN its lazy chunks answer 403.
COPY --from=web-bundle /forms-flow-web/build/forms-flow-web.js /usr/share/nginx/html/mfe/forms-flow-web/
COPY --from=web-bundle /forms-flow-web/build/static /usr/share/nginx/html/mfe/forms-flow-web/static
COPY --from=vendor /out/vendor /usr/share/nginx/html/vendor
RUN find /usr/share/nginx/html/mfe/forms-flow-web /usr/share/nginx/html/vendor -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.ttf' -o -name '*.eot' \) \
      -exec gzip -9 -k {} +

# Runtime files: nginx's entrypoint runs /docker-entrypoint.d/* before starting nginx.
COPY forms-flow-web-root-config/public/config/config.template.js /etc/formsflow/config.template.js
COPY --chmod=755 forms-flow-web-root-config/docker/40-formsflow-config.sh /docker-entrypoint.d/
# Kept for deployments that still run it from a postStart hook or an entrypoint override.
COPY --chmod=755 forms-flow-web-root-config/env.sh /usr/share/nginx/html/config/env.sh

COPY forms-flow-web-root-config/nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
