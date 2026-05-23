# Standalone logic verification for regional.py BfpXlsxParser fix

class BfpXlsxParser:
    def __init__(self, ws):
        self.ws = ws

    def get(self, coord: str):
        return self.ws.get(coord)

    def _is_marked(self, coord: str) -> bool:
        val = str(self.get(coord)).strip().lower() if self.get(coord) else ""
        return val in ['x', '1', 'true', 'v', '✓', '✔', '/']

    def parse(self) -> dict:
        responder_type = "First Responder"
        if self._is_marked("B21"):
            responder_type = "Augmenting Team"
        
        fire_station = self.get("D20") or self.get("D21")

        data = {
            "responder_type": responder_type,
            "fire_station_name": fire_station or "",
            "classification": "Structural",
            "extent_of_damage": "",
        }
        
        # Classification refine
        if self._is_marked("B49"):
            data["classification"] = "Non-Structural"
        elif self._is_marked("B50"):
            data["classification"] = "Transportation"

        # Stage of Fire refine: if dropdown B54 is still the prompt, return empty
        stage = self.get("B54")
        if stage and "pick from dropdown" in str(stage).lower():
            stage = ""
        data["stage_of_fire"] = stage

        # Extent of Damage checkboxes: B56 to B61
        extent_labels = {
            "B56": "None/Minor Damage",
            "B57": "Confined to Object/Vehicle",
            "B58": "Confined to Room",
            "B59": "Confined to Structure or Property",
            "B60": "Total Loss",
            "B61": "Extended Beyond Structure or Property"
        }
        for coord, label in extent_labels.items():
            if self._is_marked(coord):
                data["extent_of_damage"] = label
                break

        return data

# Verification
def test():
    print("--- STANDALONE VERIFICATION ---")
    
    # Test 1: '/' marker
    ws1 = {"B21": "/", "D21": "Station B", "B50": "x", "B60": "✓"}
    data1 = BfpXlsxParser(ws1).parse()
    assert data1["responder_type"] == "Augmenting Team"
    assert data1["classification"] == "Transportation"
    assert data1["extent_of_damage"] == "Total Loss"
    print("Test 1 Passed: '/' and '✓' markers detected.")

    # Test 2: 'x' and dropdown logic
    ws2 = {"B20": "x", "D20": "Station A", "B54": "Structural Fire"}
    data2 = BfpXlsxParser(ws2).parse()
    assert data2["responder_type"] == "First Responder"
    assert data2["stage_of_fire"] == "Structural Fire"
    print("Test 2 Passed: 'x' marker and dropdown value detected.")

    # Test 3: Dropdown prompt cleanup
    ws3 = {"B54": "Stage of Fire Upon Arrival (pick from dropdown list)"}
    data3 = BfpXlsxParser(ws3).parse()
    assert data3["stage_of_fire"] == ""
    print("Test 3 Passed: Dropdown prompt cleaned up.")

    print("\nALL STANDALONE TESTS PASSED.")

if __name__ == "__main__":
    test()
