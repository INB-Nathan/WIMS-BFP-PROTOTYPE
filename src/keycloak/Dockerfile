FROM maven:3.9.9-eclipse-temurin-17 AS provider-builder

WORKDIR /workspace
COPY demo-otp-provider/pom.xml demo-otp-provider/pom.xml
COPY demo-otp-provider/src demo-otp-provider/src
COPY wims-audit-event-listener/pom.xml wims-audit-event-listener/pom.xml
COPY wims-audit-event-listener/src wims-audit-event-listener/src
RUN mvn -f demo-otp-provider/pom.xml -B package && \
    mvn -f wims-audit-event-listener/pom.xml -B package

FROM quay.io/keycloak/keycloak:24.0.0

COPY --from=provider-builder /workspace/demo-otp-provider/target/wims-demo-otp-provider.jar /opt/keycloak/providers/wims-demo-otp-provider.jar
COPY --from=provider-builder /workspace/wims-audit-event-listener/target/wims-audit-event-listener.jar /opt/keycloak/providers/wims-audit-event-listener.jar
RUN /opt/keycloak/bin/kc.sh build
