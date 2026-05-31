"""Database session — shared dependency for routes."""

from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, Session

import os

from dotenv import load_dotenv

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.environ.get(
    "SQLALCHEMY_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://postgres:***@postgres:5432/wims"),
)

_engine: Engine = create_engine(SQLALCHEMY_DATABASE_URL)
_SessionLocal: sessionmaker = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

# Admin session — uses DATABASE_ADMIN_URL (postgres superuser) so test fixtures
# and DDL helpers can query RLS-protected tables without a user context.
# Application code must NOT use this; use get_db_with_rls() instead.
_ADMIN_DATABASE_URL: str = os.environ.get("DATABASE_ADMIN_URL", SQLALCHEMY_DATABASE_URL)
_admin_engine: Engine = create_engine(_ADMIN_DATABASE_URL)
_AdminSessionLocal: sessionmaker = sessionmaker(
    autocommit=False, autoflush=False, bind=_admin_engine
)


def get_engine() -> Engine:
    return _engine


def get_session_maker() -> sessionmaker:
    return _SessionLocal


def set_rls_context(session: Session, user_id: uuid.UUID) -> None:
    """
    Set the wims.current_user_id GUC for the lifetime of this session's transaction.
    SET LOCAL is transaction-scoped — automatically undone on commit/rollback.

    This is the linchpin for Row Level Security on all wims.* tables.
    Call this immediately after creating a session, before any RLS-protected query.
    """
    session.execute(
        text("SET LOCAL wims.current_user_id = :uid"),
        {"uid": str(user_id)},
    )


def get_db():
    """
    FastAPI dependency that yields a bare SQLAlchemy session using the admin URL.
    RLS context is NOT set here — use get_db_with_rls() or set_rls_context()
    after user resolution.

    Uses DATABASE_ADMIN_URL (postgres superuser) so auth lookups on wims.users
    succeed before a user UUID is known.  This avoids the chicken-and-egg problem
    where get_current_wims_user needs to read wims.users to get the UUID required
    to set the RLS GUC, but wims.users has FORCE ROW LEVEL SECURITY.

    Routes that use get_db() directly must not return data that should be
    filtered by RLS; use get_db_with_rls() for all protected queries.
    """
    db = _AdminSessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session(user_id: Optional[uuid.UUID] = None) -> Session:
    """
    Return a new SQLAlchemy session for Celery tasks and scripts.

    For Celery tasks that query RLS-protected tables, pass the internal
    wims user_id so that row-level security policies correctly filter data.
    Without user_id, RLS context is not set — use only for tasks that
    either run as a system service account or bypass RLS tables.

    Usage in Celery tasks:
        from database import get_session

        @celery_app.task
        def my_task(user_id: uuid.UUID, ...):
            db = get_session(user_id)
            try:
                # queries are scoped by user_id's region/role
                ...
            finally:
                db.close()
    """
    session = get_session_maker()()
    if user_id is not None:
        set_rls_context(session, user_id)
    return session


def __getattr__(name: str):
    # Lazy re-export: get_db_with_rls lives in auth.py (it depends on
    # get_current_wims_user which is defined there).  A top-level
    # "from auth import …" would create a circular import because auth.py
    # imports from database.  The module __getattr__ hook (PEP 562) defers
    # the import to the first access, by which time both modules are fully
    # loaded.  All existing "from database import get_db_with_rls" sites
    # keep working without any changes.
    if name == "get_db_with_rls":
        from auth import get_db_with_rls  # noqa: PLC0415

        return get_db_with_rls
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
