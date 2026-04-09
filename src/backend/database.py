"""Database session — shared dependency for routes."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import Request
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
_SessionLocal: sessionmaker = sessionmaker(
    autocommit=False, autoflush=False, bind=_engine
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
    FastAPI dependency that yields a bare SQLAlchemy session.
    RLS context is NOT set here — use get_db_with_rls() or set_rls_context()
    after user resolution.

    This avoids the dependency cycle where get_current_wims_user depends on
    get_db, but get_db needs the user resolved first to set RLS context.
    """
    _SessionLocal = get_session_maker()
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_with_rls(request: Request):
    """
    FastAPI dependency that yields a SQLAlchemy session with RLS context set.
    Use this ONLY in routes where get_current_wims_user has already been called
    as a dependency (so request.state.wims_user is populated).

    Usage:
        async def my_route(
            user: Annotated[dict, Depends(get_current_wims_user)],
            db: Annotated[Session, Depends(get_db_with_rls)],
        ):
            ...

    Note: get_current_wims_user must be listed BEFORE get_db_with_rls in the
    dependency list, OR FastAPI must resolve it first via dependency ordering.
    """
    _SessionLocal = get_session_maker()
    db = _SessionLocal()
    try:
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
