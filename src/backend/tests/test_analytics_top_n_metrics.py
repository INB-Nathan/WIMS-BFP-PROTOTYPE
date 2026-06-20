from unittest.mock import MagicMock

from services.analytics_read_model import get_top_n


def test_top_n_response_time_exposes_metric_sample_size():
    """Response-time Top-N must distinguish total incidents from timed incidents."""
    mock_db = MagicMock()
    mock_result = MagicMock()
    mock_result.fetchall.return_value = [("Makati", 1.0, 5, 1)]
    mock_db.execute.return_value = mock_result

    result = get_top_n(mock_db, metric="response_time", dimension="municipality")

    assert result == [
        {
            "name": "Makati",
            "value": 1.0,
            "incident_count": 5,
            "metric_count": 1,
        }
    ]

    sql = str(mock_db.execute.call_args.args[0])
    assert "COUNT(*) AS incident_count" in sql
    assert "COUNT(a.total_response_time_minutes) AS metric_count" in sql
    assert "HAVING COUNT(a.total_response_time_minutes) > 0" in sql
