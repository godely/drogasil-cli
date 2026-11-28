"""Check the CSV and XLSX CLI exports against the verified JSON export."""
import csv
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile


directory = Path(sys.argv[1])
records = json.loads((directory / "catalog.json").read_text(encoding="utf-8"))
headers = list(records[0])


def flat(value):
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    return value


with (directory / "catalog.csv").open(encoding="utf-8", newline="") as file:
    reader = csv.DictReader(file)
    assert reader.fieldnames == headers
    rows = list(reader)
    assert len(rows) == len(records)
    for row, record in zip(rows, records):
        for key, value in record.items():
            expected = "" if value is None else str(flat(value))
            assert row[key] == expected, (record["sku"], key)

with ZipFile(directory / "catalog.xlsx") as book:
    sheet = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))

heading, *rows = sheet.findall(".//{*}row")
columns = {cell.get("r")[:-1]: cell.findtext("{*}is/{*}t") for cell in heading}
assert list(columns.values()) == headers
assert len(rows) == len(records)
for index, (row, record) in enumerate(zip(rows, records), 2):
    assert row.get("r") == str(index)
    values = {}
    for cell in row:
        reference = cell.get("r")
        column = reference.rstrip("0123456789")
        assert reference == column + str(index)
        key = columns[column]
        if cell.get("t") == "inlineStr":
            value = cell.findtext("{*}is/{*}t")
        elif cell.get("t") == "b":
            text = cell.findtext("{*}v")
            assert text in ("0", "1")
            value = text == "1"
        else:
            value = float(cell.findtext("{*}v"))
        values[key] = value
    for key, original in record.items():
        expected = flat(original)
        actual = values.get(key)
        assert actual == expected and isinstance(actual, bool) == isinstance(expected, bool), (index, key)
