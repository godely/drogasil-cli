"""Private SQLite snapshot store, called with a single JSON request on stdin."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import time


def enable_wal(db):
    # Concurrent first connections can receive SQLITE_BUSY immediately while
    # upgrading the journal even when the connection has a busy timeout.
    deadline = time.monotonic() + 15
    while True:
        try:
            db.execute("PRAGMA journal_mode=WAL").fetchone()
            return
        except sqlite3.OperationalError as exc:
            if str(exc) != "database is locked" or time.monotonic() >= deadline:
                raise
            time.sleep(0.05)

args = json.load(sys.stdin)
path = Path(os.environ.get("DROGASIL_SNAPSHOT_DB", Path.home() / ".local/share/drogasil/snapshots.sqlite3"))
os.umask(0o077)
path.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(path, timeout=15) as db:
    enable_wal(db)
    db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, state TEXT, started TEXT, pid INTEGER, error TEXT)")
    db.execute("CREATE TABLE IF NOT EXISTS rows (run TEXT, sku TEXT, data TEXT, PRIMARY KEY(run,sku))")
    db.execute("CREATE TABLE IF NOT EXISTS stats (run TEXT PRIMARY KEY, data TEXT)")
    rid = args["id"]
    op = args["op"]
    if op == "create":
        db.execute("INSERT INTO runs VALUES (?, 'running', ?, ?, NULL)", (rid, args["at"],args["pid"]))
    elif op == "row":
        row = args["row"]
        db.execute("INSERT INTO rows VALUES (?,?,?)", (rid, row["sku"], json.dumps(row, ensure_ascii=False)))
    elif op == "finish":
        db.execute("UPDATE runs SET state=?,error=? WHERE id=?", (args["state"],args.get("error"),rid))
        db.execute("INSERT OR REPLACE INTO stats VALUES (?,?)", (rid,json.dumps(args.get("stats",{}))))
    elif op == "read":
        collector = db.execute("SELECT pid FROM runs WHERE id=? AND state='running'", (rid,)).fetchone()
        if collector:
            pid, = collector
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                # The collector can commit its terminal state just before exiting.
                db.execute("UPDATE runs SET state='failed', error=? WHERE id=? AND state='running' AND pid=?",
                           ("Collector stopped before completion", rid, pid))
                db.commit()
        # The WAL reader sees one committed version while a collector continues writing.
        db.execute("BEGIN")
        meta = db.execute("SELECT state,started,error FROM runs WHERE id=?", (rid,)).fetchone()
        if meta is None:
            sys.exit("Unknown snapshot run")
        state, started, error = meta
        count = db.execute("SELECT COUNT(*) FROM rows WHERE run=?", (rid,)).fetchone()[0]
        offset, limit = args["offset"], args["limit"]
        rows = db.execute("SELECT data FROM rows WHERE run=? ORDER BY rowid LIMIT ? OFFSET ?", (rid,limit,offset))
        records = [json.loads(row[0]) for row in rows]
        end = offset + len(records)
        stats = db.execute("SELECT data FROM stats WHERE run=?", (rid,)).fetchone()
        print(json.dumps(dict(stats=json.loads(stats[0]) if stats else None,runId=rid,state=state,startedAt=started,error=error,count=count,offset=offset,
                              nextOffset=end if end < count or state == "running" else None,records=records)))
