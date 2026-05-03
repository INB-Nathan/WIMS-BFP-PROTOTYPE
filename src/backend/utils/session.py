import os
import redis
import time
import logging

logger = logging.getLogger("wims.session")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


class SessionManager:
    def __init__(self):
        try:
            self._redis = redis.from_url(REDIS_URL, decode_responses=True)
            self._redis.ping()
        except Exception as e:
            logger.error(f"Failed to connect to Redis for session management: {e}")
            self._redis = None

    def revoke_all_sessions(self, keycloak_id: str):
        """
        Record a revocation timestamp for a user.
        Any token issued BEFORE this time will be considered invalid.
        """
        if not self._redis:
            return

        try:
            # Mark the user as revoked at the current second.
            # TTL of 12 hours is enough as JWTs typically expire much sooner.
            self._redis.set(f"revoked_user:{keycloak_id}", int(time.time()), ex=43200)
        except Exception as e:
            logger.error(f"Redis write error during session revocation: {e}")

    def is_token_revoked(self, keycloak_id: str, iat: int) -> bool:
        """
        Check if a token issued at 'iat' has been revoked.
        """
        if not self._redis:
            return False

        try:
            revocation_time = self._redis.get(f"revoked_user:{keycloak_id}")
            if revocation_time:
                # If the token was issued before the revocation timestamp, it's invalid.
                return iat < int(revocation_time)
        except Exception as e:
            logger.error(f"Redis read error during revocation check: {e}")

        return False


# Global instance
session_manager = SessionManager()
