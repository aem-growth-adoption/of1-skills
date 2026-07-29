#!/usr/bin/env python3
"""Assemble templates/templates-catalog.json + of1/config/templates.json.

Reads every templates/of1-*.metadata.json + corresponding .html and produces
a fully-inlined catalog (slots, htmlContent, stylesheet) so the OF1 worker
can route to templates without exceeding the 50-subrequest limit.

Idempotent — safe to re-run after fixing any single template.

Usage:
    python3 assemble-catalog.py <repo-dir> <owner> <repo> <branch>
"""

import glob
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main(argv):
    if len(argv) < 5:
        print("usage: assemble-catalog.py <repo-dir> <owner> <repo> <branch>", file=sys.stderr)
        return 2

    repo_dir = Path(argv[1]).resolve()
    owner, repo, branch = argv[2], argv[3], argv[4]
    template_dir = repo_dir / "templates"
    base_url = f"https://{branch}--{repo}--{owner}.aem.page"

    if not template_dir.exists():
        print(f"templates/ not found at {template_dir}", file=sys.stderr)
        return 1

    templates = []
    by_intent = {}

    meta_files = sorted(template_dir.glob("of1-*.metadata.json"))
    if not meta_files:
        print(f"No of1-*.metadata.json files found in {template_dir}", file=sys.stderr)
        return 1

    missing_html = []
    for meta_path in meta_files:
        with meta_path.open() as f:
            meta = json.load(f)
        name = meta["name"]
        intent = meta["intent"]

        html_path = template_dir / f"{name}.html"
        if not html_path.exists():
            missing_html.append(name)
            continue
        with html_path.open() as f:
            html_content = f.read()

        entry = {
            "name": name,
            "intent": intent,
            "description": meta.get("description", ""),
            "minItems": meta.get("minItems", 1),
            "maxItems": meta.get("maxItems", 4),
            "stylesheet": meta.get("stylesheet", f"/styles/{name}.css"),
            "slots": meta.get("slots", []),
            "htmlContent": html_content,
        }
        templates.append(entry)
        by_intent.setdefault(intent, []).append(name)

    if missing_html:
        print(f"ERROR: missing HTML for: {', '.join(missing_html)}", file=sys.stderr)
        return 1

    for intent in by_intent:
        by_intent[intent].sort()

    catalog = {
        "useRouting": True,
        "baseUrl": base_url,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "count": len(templates),
        "byIntent": dict(sorted(by_intent.items())),
        "templates": templates,
    }

    catalog_path = template_dir / "templates-catalog.json"
    with catalog_path.open("w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Wrote {catalog_path} with {len(templates)} fully-inlined templates")

    config_dir = repo_dir / "of1" / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    routing = {
        "useRouting": True,
        "baseUrl": base_url,
        "catalogPath": "/templates/templates-catalog.json",
    }
    routing_path = config_dir / "templates.json"
    with routing_path.open("w") as f:
        json.dump(routing, f, indent=2)
    print(f"Wrote {routing_path}")

    intents_seen = sorted(by_intent.keys())
    expected = {"comparison", "recommendation", "deep-dive", "budget", "discovery"}
    missing_intents = sorted(expected - set(intents_seen))
    if missing_intents:
        print(f"WARNING: catalog is missing intents: {missing_intents}", file=sys.stderr)

    print(f"By intent: {json.dumps(by_intent, indent=2)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
