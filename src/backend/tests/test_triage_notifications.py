from api.routes import triage


def test_enqueue_status_notification_logs_and_suppresses_publish_errors(monkeypatch):
    class FailingTask:
        @staticmethod
        def delay(report_id: int, status: str) -> None:
            raise RuntimeError("broker unavailable")

    logged: dict[str, object] = {}

    def fake_exception(message: str, *args: object) -> None:
        logged["message"] = message
        logged["args"] = args

    monkeypatch.setattr(triage, "send_status_notification", FailingTask)
    monkeypatch.setattr(triage.logger, "exception", fake_exception)

    triage._enqueue_status_notification(123, "VERIFIED")

    assert logged["message"] == ("Failed to enqueue status notification for report_id=%s status=%s")
    assert logged["args"] == (123, "VERIFIED")
