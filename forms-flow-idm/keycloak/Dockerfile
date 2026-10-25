FROM maven:3.8.7-openjdk-18-slim AS builder

WORKDIR /build

# Dependency downloads persist between builds in a cache mount (not part of the image).
# build.sh --no-cache sets CACHE_ID to start from an empty one.
ARG CACHE_ID=shared

COPY idp-selector/pom.xml idp-selector/
COPY idp-selector/src idp-selector/src/

# Maven 3.8 waits 30 min on a stalled download by default: give up after 60 s and retry.
RUN --mount=type=cache,id=ff-m2-$CACHE_ID,target=/root/.m2 \
    mvn -B -Dmaven.wagon.rto=60000 -Dmaven.wagon.http.retryHandler.count=3 -f idp-selector/pom.xml clean package

FROM alpine:latest

WORKDIR /custom

COPY --from=builder /build/idp-selector/target/*.jar /custom/providers/
COPY ./themes /custom/themes
COPY ./imports /custom/imports
COPY ./start-keycloak.sh /custom/start-keycloak.sh
