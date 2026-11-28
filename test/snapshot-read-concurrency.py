"""Force two specific reader/writer interleavings against a real WAL database."""
import io
import json
import os
from pathlib import Path
import runpy
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


worker = Path(__file__).resolve().parents[1] / "src/snapshots/db.py"


def call(op, **fields):
    payload = json.dumps({"id": "run", "op": op, **fields})
    with patch("sys.stdin", io.StringIO(payload)), patch("sys.stdout", new_callable=io.StringIO) as output:
        runpy.run_path(str(worker), run_name="__main__")
    return json.loads(output.getvalue()) if op == "read" else None


class SnapshotRead(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "runs.sqlite"
        env = patch.dict(os.environ, DROGASIL_SNAPSHOT_DB=str(self.path))
        env.start()
        self.addCleanup(env.stop)
        call("create", at="2026-01-01T00:00:00Z", pid=os.getpid())
        call("row", row={"sku": "1"})
        self.writer = sqlite3.connect(self.path)
        self.addCleanup(self.writer.close)

    def test_page_uses_one_view_of_rows_state_and_statistics(self):
        connect = sqlite3.connect
        appended = False

        def connect_reader(*args, **kwargs):
            db = connect(*args, **kwargs)

            def before_query(sql):
                nonlocal appended
                if not appended and sql.startswith("SELECT data FROM rows"):
                    with self.writer:
                        self.writer.execute("INSERT INTO rows VALUES ('run','2',?)", (json.dumps({"sku": "2"}),))
                        self.writer.execute("UPDATE runs SET state='succeeded' WHERE id='run'")
                        self.writer.execute("INSERT INTO stats VALUES ('run','{}')")
                    appended = True

            db.set_trace_callback(before_query)
            return db

        with patch("sqlite3.connect", connect_reader):
            first = call("read", offset=0, limit=20)
        self.assertTrue(appended)
        self.assertEqual((first["state"], first["count"], first["records"], first["stats"], first["nextOffset"]),
                         ("running", 1, [{"sku": "1"}], None, 1))
        second = call("read", offset=first["nextOffset"], limit=20)
        self.assertEqual((second["state"], second["count"], second["records"], second["stats"], second["nextOffset"]),
                         ("succeeded", 2, [{"sku": "2"}], {}, None))

    def test_collector_finishing_during_liveness_check_keeps_its_actual_outcome(self):
        def collector_just_exited(pid, signal):
            with self.writer:
                self.writer.execute("UPDATE runs SET state='succeeded' WHERE id='run'")
                self.writer.execute("INSERT INTO stats VALUES ('run','{}')")
            raise ProcessLookupError

        with patch("os.kill", collector_just_exited):
            result = call("read", offset=0, limit=20)
        self.assertEqual((result["state"], result["error"], result["stats"]), ("succeeded", None, {}))

    def test_abandoned_run_keeps_its_partial_rows(self):
        with patch("os.kill", side_effect=ProcessLookupError):
            result = call("read", offset=0, limit=20)
        self.assertEqual((result["state"], result["records"], result["nextOffset"]), ("failed", [{"sku": "1"}], None))


if __name__ == "__main__":
    unittest.main()
