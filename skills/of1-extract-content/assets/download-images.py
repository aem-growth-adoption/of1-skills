#!/usr/bin/env python3
"""download-images.py — Parallel product-image download + upload to DA.

Reads a manifest of products + image URLs, downloads each image concurrently,
sniffs its content type from magic bytes (so JPEGs aren't uploaded as PNGs),
and uploads to DA via the filesystem mount when available or admin.da.live PUT
otherwise. Default concurrency is 8 workers — enough to saturate I/O without
being rude to source servers.

Usage:
    python3 download-images.py \\
        --input image-manifest.json \\
        --owner aem-growth-adoption \\
        --repo of1-demo-orchestrator \\
        --branch wknd-2 \\
        [--output image-mapping.json] \\
        [--max-per-product 5] \\
        [--workers 8] \\
        [--update-products] \\
        [--products-json of1/config/products.json] \\
        [--token-file path/to/token.json]

Manifest shape:
    [{"productId": "house-blend", "urls": ["https://...", "https://..."]}, ...]

Token resolution order (first that works wins):
    1. --token-file <path>
    2. $DA_TOKEN env var (raw token)
    3. $ADOBE_IMS_TOKEN env var (raw token, Claude Code convention)
    4. $OF1_TOKEN_FILE env var (path to token JSON)
    5. `oauth-token adobe` (SLICC shim)
    6. ./.hlx/.da-token.json (project default)
"""

import argparse
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
MIN_BYTES = 10_000
DEFAULT_WORKERS = 8


# (magic_prefix, mime, extension)
MAGIC = [
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
]


def detect_content_type(data):
    for magic, mime, ext in MAGIC:
        if data.startswith(magic):
            return mime, ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return "image/png", "png"  # safe fallback


def _read_token_file(path):
    with open(path) as f:
        data = json.load(f)
    token = data.get("access_token") or data.get("token")
    if not token:
        raise RuntimeError(f"Token file {path} missing access_token / token field")
    return token


def resolve_token(token_file_arg):
    if token_file_arg:
        return _read_token_file(token_file_arg)
    if os.environ.get("DA_TOKEN"):
        return os.environ["DA_TOKEN"]
    if os.environ.get("ADOBE_IMS_TOKEN"):
        return os.environ["ADOBE_IMS_TOKEN"]
    if os.environ.get("OF1_TOKEN_FILE"):
        return _read_token_file(os.environ["OF1_TOKEN_FILE"])
    try:
        result = subprocess.run(
            ["oauth-token", "adobe"], capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except FileNotFoundError:
        pass
    for candidate in [".hlx/.da-token.json"]:
        if os.path.exists(candidate):
            return _read_token_file(candidate)
    raise RuntimeError(
        "Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN, "
        "or place token JSON at .hlx/.da-token.json."
    )


def download(url, dest_path):
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as resp:
            if resp.status not in (200, 301, 302):
                return None, f"HTTP {resp.status}"
            data = resp.read()
    except HTTPError as e:
        return None, f"HTTP {e.code}"
    except URLError as e:
        return None, f"URL error: {e.reason}"
    except Exception as e:
        return None, f"download error: {e}"
    if len(data) < MIN_BYTES:
        return None, f"too small ({len(data)} bytes)"
    with open(dest_path, "wb") as f:
        f.write(data)
    return data, None


def trigger_preview(token, owner, repo, branch, filename):
    """Ingest the uploaded media file into EDS's Media Bus so it resolves at
    {branch}--{repo}--{owner}.aem.page/media/{filename}. Without this, the
    file only exists in DA's source store — content.da.live is not a public
    delivery endpoint (auth-gated) and the aem.page path 404s until previewed.
    """
    url = f"https://admin.hlx.page/preview/{owner}/{repo}/{branch}/media/{filename}"
    try:
        conn = http.client.HTTPSConnection("admin.hlx.page", timeout=30)
        conn.request(
            "POST",
            f"/preview/{owner}/{repo}/{branch}/media/{filename}",
            headers={
                "Authorization": f"Bearer {token}",
                "x-content-source-authorization": f"Bearer {token}",
            },
        )
        resp = conn.getresponse()
        resp.read()
        conn.close()
    except Exception as e:
        return f"preview error: {e}"
    if resp.status in (200, 201, 204):
        return None
    return f"preview HTTP {resp.status}"


def upload(tmp_file, content_type, token, owner, repo, branch, filename, mount_dir):
    if mount_dir:
        mount_path = Path(mount_dir) / branch / "media" / filename
        try:
            mount_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(tmp_file, mount_path)
        except Exception:
            pass  # fall through to API
        else:
            err = trigger_preview(token, owner, repo, branch, filename)
            return ("mount", err) if err else ("mount", None)
    url = f"https://admin.da.live/source/{owner}/{repo}/media/{filename}"
    with open(tmp_file, "rb") as f:
        body = f.read()
    # DA requires multipart/form-data with field name "data" for binary uploads.
    # Raw PUT silently returns 2xx but doesn't persist the file.
    boundary = "----DABoundary" + os.urandom(8).hex()
    crlf = b"\r\n"
    parts = [
        b"--" + boundary.encode(),
        f'Content-Disposition: form-data; name="data"; filename="{filename}"'.encode(),
        f"Content-Type: {content_type}".encode(),
        b"",
        body,
        b"--" + boundary.encode() + b"--",
        b"",
    ]
    payload = crlf.join(parts)
    parsed = urlparse(url)
    try:
        conn = http.client.HTTPSConnection(parsed.netloc, timeout=30)
        conn.request(
            "POST",
            parsed.path,
            body=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(payload)),
            },
        )
        resp = conn.getresponse()
        resp.read()
        conn.close()
    except Exception as e:
        return None, f"upload error: {e}"
    if resp.status not in (200, 201, 204):
        return None, f"HTTP {resp.status}"
    # File is uploaded to DA's source store but not yet in the Media Bus —
    # request a preview so it becomes reachable at the site's /media/ path.
    err = trigger_preview(token, owner, repo, branch, filename)
    if err:
        return None, err
    return "api", None


def process_one(task, token, owner, repo, branch, mount_dir, tmpdir):
    product_id = task["productId"]
    n = task["n"]
    url = task["url"]
    tmp_file = Path(tmpdir) / f"product-{product_id}-{n}"
    data, err = download(url, tmp_file)
    if err:
        return {
            "product_id": product_id,
            "n": n,
            "ok": False,
            "stage": "download",
            "err": err,
        }
    content_type, ext = detect_content_type(data)
    filename = f"product-{product_id}-{n}.{ext}"
    method, err = upload(
        tmp_file, content_type, token, owner, repo, branch, filename, mount_dir
    )
    try:
        tmp_file.unlink()
    except FileNotFoundError:
        pass
    if err:
        return {
            "product_id": product_id,
            "n": n,
            "ok": False,
            "stage": "upload",
            "err": err,
        }
    return {
        "product_id": product_id,
        "n": n,
        "ok": True,
        "method": method,
        "filename": filename,
        "size": len(data),
    }


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--owner", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--branch", required=True)
    ap.add_argument("--output", default="image-mapping.json")
    ap.add_argument("--max-per-product", type=int, default=5)
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    ap.add_argument("--update-products", action="store_true")
    ap.add_argument("--products-json", default="of1/config/products.json")
    ap.add_argument("--token-file")
    ap.add_argument("--mount-dir", default="/mnt/da")
    args = ap.parse_args(argv)

    token = resolve_token(args.token_file)
    mount_dir = args.mount_dir if Path(args.mount_dir).exists() else None

    with open(args.input) as f:
        manifest = json.load(f)

    tasks = []
    for item in manifest:
        pid = item["productId"]
        for n, url in enumerate(item.get("urls", [])[: args.max_per_product], 1):
            tasks.append({"productId": pid, "n": n, "url": url})

    print(
        f"Processing {len(tasks)} images across {len(manifest)} products "
        f"(workers={args.workers}, mount={'yes' if mount_dir else 'no'})"
    )

    results = []
    with tempfile.TemporaryDirectory(prefix="dl-img-") as tmpdir:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [
                ex.submit(
                    process_one, t, token, args.owner, args.repo,
                    args.branch, mount_dir, tmpdir,
                )
                for t in tasks
            ]
            for fut in as_completed(futures):
                r = fut.result()
                results.append(r)
                if r["ok"]:
                    print(
                        f"  ok {r['product_id']}[{r['n']}]: "
                        f"{r['size']//1024}KB -> {r['method']}  ({r['filename']})"
                    )
                else:
                    print(
                        f"  FAIL {r['product_id']}[{r['n']}]: "
                        f"{r['stage']} {r['err']}"
                    )

    ok_n = sum(1 for r in results if r["ok"])
    fail_n = len(results) - ok_n
    print(f"\nSummary: {ok_n} uploaded, {fail_n} failed.")

    mapping = {}
    for r in results:
        if r["ok"]:
            url = (
                f"https://{args.branch}--{args.repo}--{args.owner}.aem.page/"
                f"media/{r['filename']}"
            )
            mapping.setdefault(r["product_id"], []).append((r["n"], url))
    for pid in mapping:
        mapping[pid] = [u for _, u in sorted(mapping[pid])]

    with open(args.output, "w") as f:
        json.dump(mapping, f, indent=2)
    print(f"Mapping written to: {args.output}")

    if args.update_products:
        pj = Path(args.products_json)
        if pj.exists():
            with pj.open() as f:
                products = json.load(f)
            updated = 0
            for p in products:
                pid = p.get("id", "")
                if pid in mapping:
                    p["images"] = mapping[pid]
                    updated += 1
            with pj.open("w") as f:
                json.dump(products, f, indent=2)
            print(f"Updated {updated} products in {pj}")
        else:
            print(
                f"WARN: --update-products requested but {pj} not found",
                file=sys.stderr,
            )

    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
