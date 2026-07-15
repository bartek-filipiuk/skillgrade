#!/usr/bin/env python3
"""Deterministic gate for rubric-authoring tasks.

Usage: python3 scripts/check_rubric.py <protocol|security|quality|hygiene>...
Exit 0 = pass. Zero deps, offline.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

DIR = pathlib.Path("rubric/skill")

# dimension -> (file, id prefix, required ids)
DIMENSIONS = {
    "security": ("10-security.md", "S", [f"S{i:02d}" for i in range(1, 13)]),
    "quality": ("20-quality.md", "Q", [f"Q{i:02d}" for i in range(1, 11)]),
    "hygiene": ("30-hygiene.md", "H", [f"H{i:02d}" for i in range(1, 9)]),
}
HEADER = re.compile(r"^## ([SQH]\d{2}) — .+$", re.M)
PROTOCOL_MARKERS = [
    "skill-content",       # untrusted-content delimiters
    "verdict.schema.json", # output contract
    "not-applicable",      # status definitions present
    "precheck-report",     # layer-1 input handling
]


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def check_protocol() -> None:
    meta = DIR / "meta.json"
    if not meta.is_file():
        fail("missing rubric/skill/meta.json")
    version = json.loads(meta.read_text()).get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail(f"meta.json version not semver: {version!r}")
    p = DIR / "00-protocol.md"
    if not p.is_file():
        fail("missing 00-protocol.md")
    text = p.read_text()
    for marker in PROTOCOL_MARKERS:
        if marker not in text:
            fail(f"00-protocol.md missing marker: {marker!r}")
    print("OK protocol")


def check_dimension(key: str) -> None:
    file, _prefix, required = DIMENSIONS[key]
    path = DIR / file
    if not path.is_file():
        fail(f"missing {path}")
    text = path.read_text()
    ids = HEADER.findall(text)
    if len(ids) != len(set(ids)):
        fail(f"{file}: duplicate check ids")
    missing = [i for i in required if i not in ids]
    if missing:
        fail(f"{file}: missing checks {missing}")
    # per-check section content requirements
    sections = re.split(r"^## ", text, flags=re.M)[1:]
    for sec in sections:
        m = re.match(r"([SQH]\d{2}) — ", sec)
        if not m:
            continue  # non-check section (e.g. Known gaps) — parser ignores it too
        cid = m.group(1)
        if not re.search(r"^severity: (critical|major|minor)\s*$", sec, re.M):
            fail(f"{cid}: missing/invalid severity line")
        if not re.search(r"^weight: \d+\s*$", sec, re.M):
            fail(f"{cid}: missing/invalid weight line")
        for part in ("**Definition:**", "**How to look:**"):
            if part not in sec:
                fail(f"{cid}: missing {part}")
        if "example" not in sec.lower():
            fail(f"{cid}: no pass/fail example")
    print(f"OK {key} ({len(ids)} checks)")


if __name__ == "__main__":
    targets = sys.argv[1:]
    if not targets:
        print("usage: check_rubric.py <protocol|security|quality|hygiene>...", file=sys.stderr)
        sys.exit(2)
    for t in targets:
        if t == "protocol":
            check_protocol()
        elif t in DIMENSIONS:
            check_dimension(t)
        else:
            fail(f"unknown target: {t}")
