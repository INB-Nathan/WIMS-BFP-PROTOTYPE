package gov.bfp.wims.keycloak;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;

import org.jboss.logging.Logger;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventType;
import org.keycloak.events.admin.AdminEvent;

/**
 * Keycloak EventListenerProvider that pushes LOGIN_ERROR, USER_DISABLED_BY_PERMANENT_LOCKOUT,
 * UPDATE_PASSWORD, and SEND_RESET_PASSWORD events to the WIMS backend audit endpoint.
 *
 * Auth: Bearer token from WIMS_KEYCLOAK_EVENT_SECRET env var.
 * Failures are logged and swallowed — never interrupt login on audit failure.
 */
public class WimsAuditEventListenerProvider implements EventListenerProvider {

    private static final Logger logger = Logger.getLogger(WimsAuditEventListenerProvider.class);

    private static final Set<EventType> CAPTURED_EVENTS = Set.of(
        EventType.LOGIN_ERROR,
        EventType.USER_DISABLED_BY_PERMANENT_LOCKOUT,
        EventType.UPDATE_PASSWORD,
        EventType.SEND_RESET_PASSWORD
    );

    // Shared HTTP client — thread-safe, reused across provider instances.
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    private final String ingestUrl;
    private final String secret;

    public WimsAuditEventListenerProvider(String ingestUrl, String secret) {
        this.ingestUrl = ingestUrl;
        this.secret = secret;
    }

    @Override
    public void onEvent(Event event) {
        if (!CAPTURED_EVENTS.contains(event.getType())) {
            return;
        }
        if (ingestUrl == null || ingestUrl.isBlank()) {
            logger.warnf("[wims-audit] WIMS_AUDIT_INGEST_URL not set — skipping push for %s",
                event.getType().name());
            return;
        }

        String keycloakEventType = event.getType().name();
        String username = event.getDetails() != null
            ? event.getDetails().getOrDefault("username", null)
            : null;
        String error = event.getError();
        String eventId = event.getId() != null ? String.valueOf(event.getId()) : null;

        String body = buildJson(keycloakEventType, username, error, eventId);

        try {
            HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                .uri(URI.create(ingestUrl))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));

            if (secret != null && !secret.isBlank()) {
                reqBuilder.header("Authorization", "Bearer " + secret);
            }

            HttpResponse<String> response = HTTP_CLIENT.send(
                reqBuilder.build(),
                HttpResponse.BodyHandlers.ofString()
            );

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.warnf("[wims-audit] Backend returned HTTP %d for event %s",
                    response.statusCode(), keycloakEventType);
            } else {
                logger.debugf("[wims-audit] Pushed %s → HTTP %d", keycloakEventType, response.statusCode());
            }
        } catch (Exception e) {
            // Swallow — never block Keycloak login on audit failure.
            logger.warnf("[wims-audit] Push failed for event %s: %s",
                keycloakEventType, e.getMessage());
        }
    }

    @Override
    public void onEvent(AdminEvent adminEvent, boolean includeRepresentation) {
        // Admin events not captured — realm events only.
    }

    @Override
    public void close() {}

    private String buildJson(String eventType, String username, String error, String eventId) {
        return "{"
            + "\"event_type\":" + jsonString(eventType)
            + ",\"username\":" + jsonString(username)
            + ",\"error\":" + jsonString(error)
            + ",\"keycloak_event_id\":" + jsonString(eventId)
            + "}";
    }

    private String jsonString(String value) {
        if (value == null) return "null";
        // Escape backslash, double-quote, and common control characters.
        return "\"" + value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
            + "\"";
    }
}
