package gov.bfp.wims.keycloak;

import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

/**
 * Factory for WimsAuditEventListenerProvider.
 *
 * Reads WIMS_AUDIT_INGEST_URL and WIMS_KEYCLOAK_EVENT_SECRET once at init time
 * and passes them to each provider instance. Missing env vars produce log warnings
 * but never prevent Keycloak from starting.
 */
public class WimsAuditEventListenerProviderFactory implements EventListenerProviderFactory {

    private static final Logger logger = Logger.getLogger(WimsAuditEventListenerProviderFactory.class);

    public static final String PROVIDER_ID = "wims-audit-event-listener";

    private String ingestUrl;
    private String secret;

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return new WimsAuditEventListenerProvider(ingestUrl, secret);
    }

    @Override
    public void init(Config.Scope config) {
        ingestUrl = System.getenv("WIMS_AUDIT_INGEST_URL");
        secret = System.getenv("WIMS_KEYCLOAK_EVENT_SECRET");

        if (ingestUrl == null || ingestUrl.isBlank()) {
            logger.warn("[wims-audit-event-listener] WIMS_AUDIT_INGEST_URL not set"
                + " — audit push will be a no-op");
        }
        if (secret == null || secret.isBlank()) {
            logger.warn("[wims-audit-event-listener] WIMS_KEYCLOAK_EVENT_SECRET not set"
                + " — backend will reject all events with 401 (fail-closed)");
        }
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {}

    @Override
    public void close() {}

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}
