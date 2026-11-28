"""Write rows from one bounded catalog run to stdout."""
import csv
import json
import sys
from zipfile import ZipFile, ZIP_DEFLATED

rows = json.load(sys.stdin)
columns = list(dict.fromkeys(key for row in rows for key in row)) if rows else ["sku","name","brand","categories","categoryPath","productUrl","currentPrice","listPrice","discountPercentage","currency","stockSignal","inStock","seller","searchQuery","sourceUrl","scrapedAt"]

def column_name(index):
    label = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        label = chr(65 + remainder) + label
    return label


def flat(v):
    return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v

if sys.argv[1] == "csv":
    out = csv.writer(sys.stdout)
    out.writerow(columns)
    for row in rows:
        values = [flat(row.get(k)) for k in columns]
        out.writerow(["'" + v if isinstance(v, str) and v.lstrip().startswith(("=","+","-","@")) else v for v in values])
elif sys.argv[1] == "xlsx":
    from xml.etree.ElementTree import Element, SubElement, tostring
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    root = Element("worksheet", xmlns=main)
    data = SubElement(root,"sheetData")
    for rid, values in enumerate([columns, *([flat(r.get(k)) for k in columns] for r in rows)],1):
        row = SubElement(data,"row",r=str(rid))
        for col, value in enumerate(values):
            if value is None: continue
            cell = SubElement(row,"c",r=column_name(col + 1)+str(rid))
            if isinstance(value, bool):
                cell.set("t","b"); SubElement(cell,"v").text = str(int(value))
            elif isinstance(value,(float,int)):
                SubElement(cell,"v").text = str(value)
            else:
                cell.set("t","inlineStr"); SubElement(SubElement(cell,"is"),"t").text = str(value)
    def relation(kind,target):
        return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'/'+kind+'" Target="'+target+'"/></Relationships>'
    with ZipFile(sys.stdout.buffer,"w",ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels",relation("officeDocument","xl/workbook.xml"))
        z.writestr("xl/workbook.xml",'<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",relation("worksheet","worksheets/sheet1.xml"))
        z.writestr("xl/worksheets/sheet1.xml",tostring(root,encoding="utf-8"))
