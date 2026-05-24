from services.civilian_triage import notifications


def test_enqueue_status_notification_logs_and_suppresses_publish_errors(monkeypatch):
    class FailingTask:
        @staticmethod
        def delay(report_id: int, status: str) -> None:
            raise RuntimeError("broker unavailable")

    logged: dict[str, object] = {}

    def fake_exception(message: str, *args: object) -> None:
        logged["message"] = message
        logged["args"] = args

    monkeypatch.setattr(notifications, "send_status_notification", FailingTask)
    monkeypatch.setattr(notifications.logger, "exception", fake_exception)

    notifications.enqueue_status_notification(123, "VERIFIED")

    assert logged["message"] == ("Failed to enqueue status notification for report_id=%s status=%s")
    assert logged["args"] == (123, "VERIFIED")
