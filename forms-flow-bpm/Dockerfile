
# Maven build
FROM maven:3.8.1-openjdk-17-slim AS MAVEN_TOOL_CHAIN
COPY settings-docker.xml /usr/share/maven/ref/
WORKDIR /tmp/

COPY pom*.xml .
COPY forms-flow-bpm-utils/pom.xml ./forms-flow-bpm-utils/
COPY forms-flow-bpm-camunda/pom.xml ./forms-flow-bpm-camunda/

# COPY src /tmp/src/
COPY forms-flow-bpm-camunda/src ./forms-flow-bpm-camunda/src/
COPY forms-flow-bpm-utils/src ./forms-flow-bpm-utils/src/

# Dependency downloads persist between builds in a cache mount (not part of the image), so a
# source change doesn't download everything again. A separate dependency layer
# (dependency:go-offline) doesn't work here: it can't resolve netty-tcnative's
# ${os.detected.classifier}, which only the full build sets. build.sh --no-cache sets
# CACHE_ID to start from an empty cache.
ARG CACHE_ID=shared
# Maven 3.8 waits 30 min on a stalled download by default: give up after 60 s and retry.
RUN --mount=type=cache,id=ff-m2-$CACHE_ID,target=/root/.m2 \
    mvn -B -Dmaven.wagon.rto=60000 -Dmaven.wagon.http.retryHandler.count=3 -s /usr/share/maven/ref/settings-docker.xml install -P camunda


FROM openjdk:21-ea-jdk

# set label for image
LABEL Name="formsflow"

ENV JAVA_VERSION=21-ea+14
ENV JAVA_HOME=/opt/java/openjdk-21\
    PATH="/opt/java/openjdk-21/bin:$PATH"

EXPOSE 8080
# OpenShift has /app in the image, but it's missing when doing local development - Create it when missing
RUN test ! -d /app && mkdir /app || :
# Add spring boot application
RUN mkdir -p /app
COPY sslcom.cer /app/sslcom.cer
COPY --from=MAVEN_TOOL_CHAIN /tmp/forms-flow-bpm-camunda/target/forms-flow-bpm.jar ./app
RUN chmod a+rwx -R /app
RUN keytool -import -trustcacerts \
    -alias sslcom-cert \
    -file /app/sslcom.cer \
    -keystore  /usr/java/openjdk-21/lib/security/cacerts \
    -storepass changeit \
    -noprompt
WORKDIR /app
VOLUME /tmp
ENTRYPOINT ["java","-Djava.security.egd=file:/dev/./urandom", "-Dpolyglot.js.nashorn-compat=true", "-Dpolyglot.engine.WarnInterpreterOnly=false", "-jar","/app/forms-flow-bpm.jar"]