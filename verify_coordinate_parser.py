import io
import openpyxl
from typing import Any, List, Dict

# Mock the parser and mapper logic from regional.py for standalone testing
class BfpXlsxParser:
    def __init__(self, ws):
        self.ws = ws

    def get(self, coord: str) -> Any:
        val = self.ws[coord].value
        if val is None: return None
        if isinstance(val, str): return val.strip()
        return val

    def _is_marked(self, coord: str) -> bool:
        val = str(self.get(coord)).strip().lower() if self.get(coord) else ""
        return val in ['x', '1', 'true', 'v', '✓', '✔', '/']

    def parse(self) -> dict:
        responder_type = "First Responder" if self._is_marked("B20") else ("Augmenting Team" if self._is_marked("B21") else "First Responder")
        classification = "Structural"
        cat_val = self.get("D48")
        if self._is_marked("B49"):
            classification = "Non-Structural"
            cat_val = self.get("D49")
        elif self._is_marked("B50"):
            classification = "Transportation"
            cat_val = self.get("D50")

        extent = "None/Minor Damage"
        if self._is_marked("C57"): extent = "Confined to Object/Vehicle"
        elif self._is_marked("C58"): extent = "Confined to Room"
        elif self._is_marked("B59"): extent = "Confined to Structure or Property"
        elif self._is_marked("C60"): extent = "Total Loss"
        elif self._is_marked("C61"): extent = "Extended Beyond Structure or Property"

        problems = []
        prob_map = {"C195": "Inaccurate address", "B199": "Traffic congestion", "B210": "Intense heat and smoke"}
        for c, flavor in prob_map.items():
            if self._is_marked(c): problems.append(flavor)

        narrative_lines = []
        for r in range(160, 191):
            line = self.get(f"B{r}")
            if line: narrative_lines.append(str(line))
        
        others = []
        for r in range(124, 133):
            name = self.get(f"B{r}")
            rem = self.get(f"E{r}")
            if name and "N/A" not in str(name).upper():
                others.append({"name": name, "designation": rem or ""})

        return {
            "responder_type": responder_type,
            "fire_station_name": self.get("D20") if responder_type == "First Responder" else self.get("D21"),
            "region": self.get("D24"),
            "province": self.get("D25"),
            "city": self.get("D26"),
            "notification_date": self.get("D22"),
            "notification_time": self.get("D23"),
            "classification": classification,
            "category": cat_val,
            "extent": extent,
            "res_bfp_truck": self.get("D70"),
            "timeline": {
                "alarm_1st": {"time": self.get("D89"), "date": self.get("E89")},
                "fuc": {"time": self.get("D99"), "date": self.get("E99")},
                "fo": {"time": self.get("D100"), "date": self.get("E100")}
            },
            "inj_civ_m": self.get("D106"), "inj_civ_f": self.get("E106"),
            "narrative": "\n".join(narrative_lines),
            "problems": problems,
            "others_list": others,
        }

def test_on_filled_xlsx():
    path = r"e:\WIMS-GIT\WIMS-BFP-PROTOTYPE\AFORs\afor_filled.xlsx"
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    parser = BfpXlsxParser(ws)
    data = parser.parse()
    
    # Assertions for Time & Fields
    print(f"DEBUG: Notification Time: {data['notification_time']}")
    assert data["region"] == "NCR", f"Expected NCR, got {data['region']}"
    assert data["city"] == "Manila", f"Expected Manila, got {data['city']}"
    assert "14:30" in str(data["notification_time"]), f"Expected 14:30, got {data['notification_time']}"
    assert data["classification"] == "Structural", f"Expected Structural, got {data['classification']}"
    assert data["category"] == "Commercial (Restaurant)", f"Expected Restaurant category, got {data['category']}"
    assert data["res_bfp_truck"] == 3.0, f"Expected 3 trucks, got {data['res_bfp_truck']}"
    assert data["inj_civ_m"] == 2.0, f"Expected 2 injured civilian males, got {data['inj_civ_m']}"
    assert "En route to the place of occurrence" in data["narrative"], "Narrative join failed"
    assert "LGU / Barangay Chairman" in str(data["others_list"]), "Other personnel mapping failed"
    
    print("ALL AFOR FIELDS AND TIME EXTRACTION VERIFIED.")

if __name__ == "__main__":
    test_on_filled_xlsx()
