#!/usr/bin/env python3
"""
Creates the example Sourcebook templates through the REST API of a running server:
  - Software Project (replaces the former "Software Design Document")
  - Scientific Paper
  - Research Project Proposal (simplified, inspired by EU Horizon Europe proposals)
  - Thesis

The server already adds them to a new workspace at its first start; use this script to recreate them (--replace),
e.g. after editing their definitions in packages/server/src/seed/templates/<id>.json — the single source of both.

Usage:  SOURCEBOOK_TOKEN=sbu_… python3 scripts/create-example-templates.py [--api http://127.0.0.1:4000] [--replace] [--only <id>…]
An access token (Settings → My agents) of an owner, or of a user who may create projects, is required: --token or
the SOURCEBOOK_TOKEN environment variable.
Existing templates with the same id are skipped, or deleted and recreated with --replace.
--only limits the run to the given template ids (e.g. --only software-project).
Retired templates (RETIRED) are deleted when --replace is given.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:4000"
TOKEN = os.environ.get("SOURCEBOOK_TOKEN", "")


def call(method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={**({"content-type": "application/json"} if body is not None else {}),
                 **({"authorization": f"Bearer {TOKEN}"} if TOKEN else {})},
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()}")


# ---------------------------------------------------------------- definitions (JSON, shared with the server)

SPEC_DIR = Path(__file__).resolve().parent.parent / "packages" / "server" / "src" / "seed" / "templates"
TEMPLATE_IDS = ["software-project", "scientific-paper", "research-project-proposal", "thesis"]


def load(tid):
    return json.loads((SPEC_DIR / f"{tid}.json").read_text(encoding="utf-8"))


TEMPLATES = [load(t) for t in TEMPLATE_IDS]
# Former templates replaced by a new one (deleted with --replace).
RETIRED = {"software-design-document": "software-project"}


def slug(name):
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def create_sections(tid, sections, parent=None, counts=None):
    for s in sections:
        block = call("POST", f"/api/templates/{tid}/blocks", {"title": s["title"], "parentId": parent})
        if s.get("objective"):
            call("PATCH", f"/api/templates/{tid}/blocks/{block['id']}", {"objective": s["objective"]})
        counts["sections"] += 1
        for sub in s.get("subs", []):
            body = {k: v for k, v in sub.items() if v is not None}
            call("POST", f"/api/templates/{tid}/blocks/{block['id']}/subblocks", body)
            counts["subblocks"] += 1
        create_sections(tid, s.get("children", []), block["id"], counts)


def main():
    global API, TOKEN
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=API)
    ap.add_argument("--replace", action="store_true", help="delete and recreate templates that already exist")
    ap.add_argument("--only", nargs="+", metavar="ID", help="only these template ids")
    ap.add_argument("--token", default=TOKEN, help="access token (default: $SOURCEBOOK_TOKEN)")
    args = ap.parse_args()
    API = args.api.rstrip("/")
    TOKEN = args.token
    if not TOKEN:
        raise SystemExit("An access token is required: --token sbu_… or SOURCEBOOK_TOKEN (Settings → My agents)")
    existing = {t["id"] for t in call("GET", "/api/templates")}
    if args.replace:
        for old, new in RETIRED.items():
            if old in existing and (not args.only or new in args.only):
                call("DELETE", f"/api/templates/{old}")
                print(f"delete {old} (replaced by {new})")
    for spec in TEMPLATES:
        tid = slug(spec["name"])
        if args.only and tid not in args.only:
            continue
        if tid in existing:
            if not args.replace:
                print(f"skip   {tid} (exists; use --replace)")
                continue
            call("DELETE", f"/api/templates/{tid}")
        created = call("POST", "/api/templates", {"name": spec["name"], "description": spec["description"]})
        counts = {"sections": 0, "subblocks": 0}
        create_sections(created["id"], spec["sections"], None, counts)
        print(f"create {created['id']}: {counts['sections']} sections, {counts['subblocks']} sub-blocks")


if __name__ == "__main__":
    sys.exit(main())
