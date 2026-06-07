"""System Admin API — decomposed package."""

from fastapi import APIRouter

from . import users, backups, security, rate_limits, monitoring, analytics, audit, scheduled_reports

router = APIRouter(tags=["admin"])
router.include_router(users.router)
router.include_router(backups.router)
router.include_router(security.router)
router.include_router(rate_limits.router)
router.include_router(monitoring.router)
router.include_router(analytics.router)
router.include_router(audit.router)
router.include_router(scheduled_reports.router)
