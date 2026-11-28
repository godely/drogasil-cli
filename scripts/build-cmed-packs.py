"""Extract registered pack identifiers from an official CMED workbook; keep no price columns."""
import argparse
import gzip
import hashlib
import json
import os
import posixpath
import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse
from zipfile import ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workbook", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--source", required=True, help="URL of the dated Anvisa PMC workbook")
args = parser.parse_args()
url = urlparse(args.source)
if url.scheme != "https" or url.hostname != "www.gov.br" or not re.fullmatch(
    r"/anvisa/pt-br/assuntos/medicamentos/cmed/precos/arquivos/lista_pmc_\d{8}_\d+\.xlsx/(?:@@|%40%40)download/file", url.path
):
    parser.error("Expected the versioned official PMC workbook URL")

ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
fields = ["REGISTRO", "PRODUTO", "TIPO DE PRODUTO (STATUS DO PRODUTO)", "SUBSTÂNCIA", "APRESENTAÇÃO"]
barcodes = ["EAN 1", "EAN 2", "EAN 3"]

def gtin(value):
    return (re.fullmatch(r"[0-9]{13}", value) and len(set(value)) > 1 and
            sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(value)) % 10 == 0)

def extract(archive):
    strings = ["".join(node.text or "" for node in item.iter(ns+"t"))
               for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    paths = {node.get("Id"): node.get("Target")
             for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    for sheet in ET.fromstring(archive.read("xl/workbook.xml")).iter(ns+"sheet"):
        filename = posixpath.normpath(posixpath.join("xl", paths[sheet.get(rel)])).lstrip("/")
        columns, records = {}, []
        with archive.open(filename) as stream:
            for _, row in ET.iterparse(stream, events=("end",)):
                if row.tag != ns+"row":
                    continue
                values = {}
                for cell in row.findall(ns+"c"):
                    col = re.sub(r"\d+", "", cell.get("r"))
                    if columns and col not in columns:
                        continue
                    value = cell.findtext(ns+"v", "")
                    if cell.get("t") == "s":
                        value = strings[int(value)]
                    values[columns.get(col,col)] = value.strip()
                if not columns and set(fields+barcodes) <= set(values.values()):
                    columns = {c: v for c, v in values.items() if v in fields+barcodes}
                elif columns:
                    codes = sorted({values.get(c, "") for c in barcodes if gtin(values.get(c, ""))})
                    if codes:
                        records.append([int(row.get("r")), codes, *(values.get(f, "") for f in fields)])
                row.clear()
        if records:
            return sheet.get("name"), records
    raise ValueError("No worksheet with registered products and valid GTINs")

with ZipFile(args.workbook) as workbook:
    sheet_name, records = extract(workbook)
data = {"source":args.source, "sha256":hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
        "sheet":sheet_name, "rows":records}
with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as temp:
    with gzip.GzipFile(filename="", fileobj=temp, mode="wb", mtime=0) as gz:
        gz.write(json.dumps(data, ensure_ascii=False, separators=(",",":")).encode())
os.chmod(temp.name, 0o644)
os.replace(temp.name, args.output)
print(f"Extracted {len(records)} source rows from {sheet_name}")
