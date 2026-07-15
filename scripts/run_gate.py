#!/usr/bin/env python3
"""Loop gate runner: run a task's `verify` and update BUILD_STATE.json.

Usage: python3 scripts/run_gate.py <task_id>
Exits 0 on PASS, non-zero on FAIL. Also prints the next runnable task.
Run from the repo root (verify commands execute with CWD = repo root).
"""
from __future__ import annotations

import datetime
import json
import pathlib
import subprocess
import sys

ST = pathlib.Path("BUILD_STATE.json")


def _next_runnable(tasks: list[dict]) -> str | None:
    done = {t["id"] for t in tasks if t["status"] == "done"}
    for t in tasks:
        if (t["status"] in ("pending", "failed") and not t.get("manual")
                and all(d in done for d in t.get("deps", []))):
            return t["id"]
    return None


def main(task_id: str) -> int:
    state = json.loads(ST.read_text())
    task = next((x for x in state["tasks"] if x["id"] == task_id), None)
    if task is None:
        print(f"unknown task: {task_id}", file=sys.stderr)
        return 2

    res = subprocess.run(task["verify"], shell=True, capture_output=True, text=True)
    task["verified_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if res.returncode == 0:
        task["status"] = "done"
        task["last_error"] = None
    else:
        task["status"] = "failed"
        task["attempts"] = task.get("attempts", 0) + 1
        task["last_error"] = (res.stdout + res.stderr)[-2000:]

    ST.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n")
    nxt = _next_runnable(state["tasks"])
    print(("PASS" if res.returncode == 0 else "FAIL"), task_id, "| next:", nxt)
    return res.returncode


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: run_gate.py <task_id>", file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
