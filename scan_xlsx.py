import openpyxl

def scan_xlsx(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    sheet = wb.active
    print(f"Scanning sheet: {sheet.title}")
    
    for row in sheet.iter_rows():
        for cell in row:
            if cell.value is not None:
                print(f"{cell.coordinate}: {cell.value}")

if __name__ == "__main__":
    scan_xlsx(r"e:\WIMS-GIT\WIMS-BFP-PROTOTYPE\AFORs\afor_filled.xlsx")
