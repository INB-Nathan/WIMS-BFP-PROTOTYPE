from pathlib import Path


def test_operation_report_unique_migration_fails_before_duplicate_constraint():
    sql = Path("../postgres-init/71_operation_report_unique.sql").read_text()

    assert "duplicate operation_citizen_reports.report_id" in sql
    assert "GROUP BY report_id" in sql
    assert "COUNT(*) > 1" in sql
    assert "RAISE EXCEPTION" in sql


def test_operation_report_unique_migration_adds_report_id_unique_index():
    sql = Path("../postgres-init/71_operation_report_unique.sql").read_text()

    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_citizen_reports_report_id" in sql
    assert "ON wims.operation_citizen_reports (report_id)" in sql
