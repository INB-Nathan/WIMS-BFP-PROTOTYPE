"""Celery task registration contract for beat-scheduled jobs."""

from celery_config import celery_app


def test_beat_scheduled_tasks_are_registered():
    celery_app.loader.import_default_modules()
    registered = set(celery_app.tasks)
    scheduled = {
        entry["task"]
        for entry in celery_app.conf.beat_schedule.values()
        if isinstance(entry, dict) and entry.get("task")
    }

    assert scheduled <= registered
