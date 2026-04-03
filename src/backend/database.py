"""Database session — shared dependency for routes."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Request
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, Session

import os

SQLALCHEMY_DATABASE_URL = os.environ.get(
    "SQLALCHEMY_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://postgres:***@postgres:5432/wims"),
)

_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(SQLALCHEMY_DATABASE_URL)
    return _engine


def get_session_maker() -> sessionmaker:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False, autoflush=False, bind=get_engine()
        )
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


def get_db(request: Request):
    """
    FastAPI dependency that yields a SQLAlchemy session with RLS context set.

    Usage:
        async def my_route(db: Annotated[Session, Depends(get_db)]):
            ...

    FastAPI automatically injects Request when it is declared as a dependency
    parameter.  RLS context is set via SET LOCAL wims.current_user_id using
    the user_id stored in request.state by get_current_wims_user().
    SET LOCAL is transaction-scoped so it is automatically undone when the
    session transaction ends.
    """
    _SessionLocal = get_session_maker()
    db = _SessionLocal()
    try:
        # If a valid user was resolved by get_current_wims_user and attached
        # to request.state, push the user_id into the session's transaction.
        wims_user = getattr(request.state, "wims_user", None)
        if wims_user is not None:
            user_id = wims_user.get("user_id")
            if user_id is not None:
                set_rls_context(db, user_id)

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
