import sys
import os

# Mock the environment to load regional.py
sys.path.append(r"e:\WIMS-GIT\WIMS-BFP-PROTOTYPE\src\backend")
from api.routes.regional import BfpXlsxParser

class MockCell:
    def __init__(self, value):
        self.value = value

class MockWS:
    def __init__(self):
        self.cells = {}
    def __getitem__(self, coord):
        if coord not in self.cells:
            self.cells[coord] = MockCell(None)
        return self.cells[coord]

# Test Case 1: First Responder with 'x'
ws1 = MockWS()
ws1.cells["B20"] = MockCell("x")
ws1.cells["D20"] = MockCell("Station A")
parser1 = BfpXlsxParser(ws1)
data1 = parser1.parse()
print(f"Test 1 (B20='x'): Responder={data1['responder_type']}, Station={data1['fire_station_name']}")

# Test Case 2: Augmenting Team with '/'
ws2 = MockWS()
ws2.cells["B21"] = MockCell("/")
ws2.cells["D21"] = MockCell("Station B")
parser2 = BfpXlsxParser(ws2)
data2 = parser2.parse()
print(f"Test 2 (B21='/'): Responder={data2['responder_type']}, Station={data2['fire_station_name']}")

# Test Case 3: Classification Transportation with '1'
ws3 = MockWS()
ws3.cells["B20"] = MockCell("x")
ws3.cells["B50"] = MockCell("1")
parser3 = BfpXlsxParser(ws3)
data3 = parser3.parse()
print(f"Test 3 (B50='1'): Classification={data3['classification']}")

# Test Case 4: Extent Total Loss with 'v'
ws4 = MockWS()
ws4.cells["B20"] = MockCell("x")
ws4.cells["B60"] = MockCell("v")
parser4 = BfpXlsxParser(ws4)
data4 = parser4.parse()
print(f"Test 4 (B60='v'): Extent={data4['extent_of_damage']}")

print("\nVerification successful if markers are detected correctly.")
