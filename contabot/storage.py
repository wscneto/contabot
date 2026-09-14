"""Catálogo e resultados locais. Tabelas da versão anterior são preservadas."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.db = root / "contabot.sqlite3"
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS skus(id TEXT PRIMARY KEY, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY, document TEXT NOT NULL);
            """)

    @contextmanager
    def connect(self):
        with sqlite3.connect(self.db, timeout=30) as conn:
            yield conn

    def all(self, table):
        assert table in {"skus", "videos"}
        with self.connect() as conn:
            return [json.loads(r[0]) for r in conn.execute(f"SELECT document FROM {table} ORDER BY rowid DESC")]

    def get(self, table, identifier):
        assert table in {"skus", "videos"}
        with self.connect() as conn:
            row = conn.execute(f"SELECT document FROM {table} WHERE id=?", (identifier,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, table, document, *, create=False):
        assert table in {"skus", "videos"}
        with self.connect() as conn:
            verb = "INSERT" if create else "INSERT OR REPLACE"
            conn.execute(f"{verb} INTO {table}(id,document) VALUES(?,?)",
                         (document["id"], json.dumps(document, ensure_ascii=False)))

    def delete(self, table, identifier):
        assert table in {"skus", "videos"}
        with self.connect() as conn:
            return conn.execute(f"DELETE FROM {table} WHERE id=?", (identifier,)).rowcount > 0
