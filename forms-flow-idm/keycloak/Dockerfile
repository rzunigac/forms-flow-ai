FROM maven:3.8.7-openjdk-18-slim@sha256:0ccb24680338459567324858307f64ccff55e4e5904487b9b376dcf672f6dafa AS builder

WORKDIR /build

COPY idp-selector/pom.xml idp-selector/
COPY idp-selector/src idp-selector/src/

RUN mvn -f idp-selector/pom.xml clean package

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

WORKDIR /custom

COPY --from=builder /build/idp-selector/target/*.jar /custom/providers/
COPY ./themes /custom/themes
COPY ./imports /custom/imports
COPY ./start-keycloak.sh /custom/start-keycloak.sh
