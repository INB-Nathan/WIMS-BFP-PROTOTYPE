"""Database session — shared dependency for routes."""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

SQLALCHEMY_DATABASE_URL = os.environ.get(
    "SQLALCHEMY_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://postgres:password@postgres:5432/wims"),
)
_engine = create_engine(SQLALCHEMY_DATABASE_URL)
_SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def get_db():
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_session():
    """Return a new session (for use in Celery tasks, scripts). Caller must close."""
    return _SessionLocal()
