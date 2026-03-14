"""Database session — shared dependency for routes."""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

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
