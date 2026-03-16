import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime
from api.routes.regional import parse_xlsx_content, BfpXlsxParser, parse_afor_report_data

def test_bfp_xlsx_parser_mapping():
    """Test that BfpXlsxParser correctly extracts values from specific coordinates."""
    mock_ws = MagicMock()
    # Mock specific BFP template coordinates
    mock_ws["B21"].value = "x" # Augmenting Team selected
    mock_ws["D21"].value = "Quezon City Fire Station"
    mock_ws["C22"].value = "2025-11-20"
    mock_ws["C26"].value = "Quezon City"
    mock_ws["C42"].value = "Second Alarm"
    
    # Classification: Transportation selected
    mock_ws["B50"].value = "/" 
    
    # Extent: Total Loss selected
    mock_ws["B60"].value = "1"
    
    mock_ws["D62"].value = 2
    mock_ws["D70"].value = 3 # BFP Trucks
    mock_ws["D89"].value = "14:30" # 1st Alarm Time
    
    parser = BfpXlsxParser(mock_ws)
    data = parser.parse()
    
    assert data["responder_type"] == "Augmenting Team"
    assert data["fire_station_name"] == "Quezon City Fire Station"
    assert data["classification"] == "Transportation"
    assert data["extent_of_damage"] == "Total Loss"
    assert data["notification_date"] == "2025-11-20"
    assert data["city"] == "Quezon City"
    assert data["alarm_level"] == "Second Alarm"
    assert data["structures_affected"] == 2
    assert data["res_bfp_trucks"] == 3
    assert data["alarm_1st"] == "14:30"

def test_parse_afor_report_data_validation():
    """Test the mapping and validation logic from extracted data to schema."""
    raw_data = {
        "notification_date": "2025-11-20",
        "fire_station_name": "Station A",
        "classification": "Structural",
        "city": "Manila",
        "structures_affected": "5",
        "res_bfp_trucks": 2,
        "alarm_1st": "14:30"
    }
    
    result = parse_afor_report_data(raw_data, region_id=13)
    
    assert result.status == "VALID"
    assert len(result.errors) == 0
    
    data = result.data
    ns = data["incident_nonsensitive_details"]
    assert ns["fire_station_name"] == "Station A"
    assert ns["structures_affected"] == 5
    assert ns["resources_deployed"]["trucks"]["bfp"] == 2
    
    # Check timeline mapping (notification_date + alarm_1st time)
    # Note: _safe_dt with just time defaults to today's date if not handled carefully, 
    # but in our parser it just returns the ISO string of the time if it matches %H:%M
    assert "14:30:00" in ns["alarm_timeline"]["alarm_1st"]

def test_parse_afor_report_data_invalid_date():
    """Test that invalid dates trigger the status=INVALID."""
    raw_data = {
        "notification_date": "Invalid Date",
        "city": "Manila"
    }
    
    result = parse_afor_report_data(raw_data, region_id=13)
    assert result.status == "INVALID"
    assert "Missing or invalid notification date" in result.errors

@patch("api.routes.regional.load_workbook")
def test_parse_xlsx_content_flow(mock_load):
    """Test the full flow of parse_xlsx_content with mocked workbook."""
    mock_wb = MagicMock()
    mock_ws = MagicMock()
    mock_wb.sheetnames = ["AFOR Sheet"]
    mock_wb["AFOR Sheet"] = mock_ws
    mock_load.return_value = mock_wb
    
    # Minimal data for validation
    mock_ws["C22"].value = "2025-11-20"
    mock_ws["C26"].value = "Manila"
    mock_ws["D56"].value = 500 # Floor area
    mock_ws["D58"].value = 0.5 # Land area
    
    results = parse_xlsx_content(b"fake content", region_id=1)
    
    assert len(results) == 1
    assert results[0].status == "VALID"
    assert results[0].data["_city_text"] == "Manila"
    assert results[0].data["incident_nonsensitive_details"]["extent_total_floor_area_sqm"] == 500
