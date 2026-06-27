"""System Admin API — decomposed package."""

from fastapi import APIRouter

from . import (
    analytics,
    anomalies,
    audit,
    backup_schedule,
    backups,
    breach,
    config,
    ip_blocklist,
    monitoring,
    privacy,
    rate_limits,
    scheduled_reports,
    security,
    sync,
    users,
)

router = APIRouter(tags=["admin"])
router.include_router(users.router)
router.include_router(backups.router)
router.include_router(backup_schedule.router)
router.include_router(security.router)
router.include_router(rate_limits.router)
router.include_router(monitoring.router)
router.include_router(analytics.router)
router.include_router(audit.router)
router.include_router(scheduled_reports.router)
router.include_router(config.router)
router.include_router(breach.router)
router.include_router(privacy.router)
router.include_router(anomalies.router)
router.include_router(ip_blocklist.router, prefix="/ip-blocklist", tags=["admin-ip-blocklist"])
router.include_router(sync.router)
