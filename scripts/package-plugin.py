"""Build the personal ChatGPT plugin using the project's canonical skills."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--app-id", required=True, help="Your registered ChatGPT connector ID")
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
if not re.fullmatch(r"asdk_app_[a-zA-Z0-9_-]+", args.app_id):
    parser.error("Expected an asdk_app_ connector ID")
name = "dev-" + args.app_id.removeprefix("asdk_app_")
description = "Compare Drogasil presentations, reference prices and nearby branch stock."
interface = {"displayName": "Drogasil", "developerName": "godely",
             "shortDescription": description, "longDescription": description,
             "category": "Other", "capabilities": [], "defaultPrompt": None}
common = {"name": name, "author": {"name": "godely"}, "version": "1.1.1", "description": description}
extension = {"apps": "./.app.json", "interface": interface}
manifests = {
    ".app.json": {"apps": {name: {"id": args.app_id}}},
    ".codex-plugin/plugin.json": {**common, **extension, "skills": "./skills/"},
    "plugin.json": {**common, "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
                    "extensions": {"com.openai": extension}},
}
entries = {key: (json.dumps(value, indent=2) + "\n").encode() for key, value in manifests.items()}
for skill in sorted((root / "skills").glob("*/SKILL.md")):
    entries[skill.relative_to(root).as_posix()] = skill.read_bytes()
with ZipFile(args.output, "x") as archive:
    for key, content in sorted(entries.items()):
        entry = ZipInfo(key, date_time=(1980, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, content, compress_type=ZIP_DEFLATED)
