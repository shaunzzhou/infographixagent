#!/usr/bin/env python3
"""
Catalog templates: convert PDFs to per-page PNGs, enumerate assets, and emit a JSON catalog
plus a human-readable prompt_template.txt in the root.

Usage:
  python scripts/catalog_templates.py <template_root>

Behavior:
  - Recurses through <template_root> and immediate subfolders.
  - For each PDF: export pages as PNG into a subfolder named after the PDF.
  - For each image (PNG/JPG/WEBP): record filename/source/size/dimensions.
  - Writes a catalog JSON to stdout.
  - Writes prompt_template.txt into <template_root> summarizing assets with usage guidance.
"""
import argparse
import base64
import json
import os
import sys
import textwrap
from pathlib import Path
from typing import Any
import fitz  # PyMuPDF
from PIL import Image
import urllib.request
import urllib.error

SUPPORTED_IMG = {'.png', '.jpg', '.jpeg', '.webp'}
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={key}"


def ensure_api_key() -> str | None:
    """Ensure GEMINI_API_KEY is in the environment by lazily loading .env."""
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("API_KEY")
    if key:
        return key

    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for raw in env_path.read_text().splitlines():
            if not raw or raw.strip().startswith("#") or "=" not in raw:
                continue
            k, v = raw.split("=", 1)
            if k in {"GEMINI_API_KEY", "API_KEY"} and v.strip():
                os.environ[k] = v.strip()
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("API_KEY")


def inline_image_payload(path: Path) -> dict[str, Any]:
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = "image/png" if path.suffix.lower() == ".png" else f"image/{path.suffix.lower().lstrip('.')}"
    return {"mime_type": mime, "data": data}


def extract_json(text: str) -> dict[str, Any] | None:
    """Best-effort JSON extraction from Gemini responses."""
    candidate = text.strip()
    if candidate.startswith("```"):
        parts = candidate.split("```")
        for part in parts:
            stripped = part.strip()
            if not stripped:
                continue
            if stripped.lower().startswith("json"):
                stripped = stripped[4:].strip()
            candidate = stripped
            break
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def describe_asset_with_gemini(asset: dict[str, Any], root: Path, brand: str, api_key: str):
    asset_path = root / asset["filename"]
    if not asset_path.exists():
        print(f"[warn] Asset not found for Gemini analysis: {asset_path}", file=sys.stderr)
        return

    print(f"[info] Analyzing {asset['filename']} via Gemini...", file=sys.stderr)

    prompt = textwrap.dedent(
        f"""
        You are cataloging brand template assets for the "{brand}" family. Analyze the provided image and
        respond with compact JSON (max ~60 words in total) using this exact structure:
        {{
          "summary": "<<=25 words describing motifs/composition>",
          "recommendedUse": "<<=12 words: when to pick this asset>",
          "layoutHints": "<<=18 words: critical layout cues or alignment rules>",
          "colorPalette": "<<=15 words naming dominant colors/gradients>",
          "copyGuidance": "<<=18 words: headline/body placement or typography implication>"
        }}
        Use natural language phrases, no Markdown or bullet markers. Focus on unique qualities that would help
        another model reuse this asset faithfully without inventing new layout instructions.
        """
    ).strip()

    url = GEMINI_ENDPOINT.format(model=GEMINI_MODEL, key=api_key)
    body = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": inline_image_payload(asset_path)}
            ]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "candidateCount": 1
        }
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        print(f"[warn] Gemini HTTP error for {asset['filename']}: {exc} {detail}", file=sys.stderr)
        return
    except Exception as exc:
        print(f"[warn] Gemini request failed for {asset['filename']}: {exc}", file=sys.stderr)
        return

    candidates = payload.get("candidates") or []
    if not candidates:
        print(f"[warn] Gemini returned no candidates for {asset['filename']}", file=sys.stderr)
        return
    parts = candidates[0].get("content", {}).get("parts", [])
    text_chunks = [part.get("text", "") for part in parts if part.get("text")]
    if not text_chunks:
        print(f"[warn] Gemini response missing text for {asset['filename']}", file=sys.stderr)
        return

    response_json = extract_json("".join(text_chunks))
    if not response_json:
        print(f"[warn] Failed to parse Gemini JSON for {asset['filename']}", file=sys.stderr)
        return

    if response_json.get("summary"):
        asset["description"] = response_json["summary"]
    for field in ("recommendedUse", "layoutHints", "colorPalette", "copyGuidance"):
        if response_json.get(field):
            asset[field] = response_json[field]

    print(f"[info] Completed {asset['filename']}", file=sys.stderr)


def export_pdf(pdf_path: Path, out_dir: Path, dpi: int = 300, root: Path | None = None):
    doc = fitz.open(pdf_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72))
        out_path = out_dir / f"{pdf_path.stem}_p{i}.png"
        pix.save(out_path)
        size_kb = round(out_path.stat().st_size / 1024)
        outputs.append({
            "filename": str(out_path.relative_to(root)) if root else out_path.name,
            "source": f"{pdf_path.name}#page={i+1}",
            "description": f"PNG {pix.width}x{pix.height}px exported from {pdf_path.name} page {i+1}",
            "width": pix.width,
            "height": pix.height,
            "sizeKB": size_kb,
            "mimeType": "image/png"
        })
    return outputs


def catalog_images(folder: Path, root: Path):
    assets = []
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        ext = entry.suffix.lower()
        if ext not in SUPPORTED_IMG:
            continue
        try:
            with Image.open(entry) as im:
                w, h = im.size
        except Exception:
            w = h = None
        size_kb = round(entry.stat().st_size / 1024)
        assets.append({
            "filename": str(entry.relative_to(root)),
            "source": entry.name,
            "description": f"{entry.suffix.upper().lstrip('.')} {w}x{h}px" if w and h else f"{entry.suffix.upper().lstrip('.')} image",
            "width": w,
            "height": h,
            "sizeKB": size_kb,
            "mimeType": f"image/{entry.suffix.lower().lstrip('.')}"
        })
    return assets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("template_dir", help="Root template directory (e.g. template-new)")
    parser.add_argument("--brand", default="Template", help="Brand name (optional)")
    args = parser.parse_args()

    root = Path(args.template_dir).resolve()
    catalog = {"brand": args.brand, "root": str(root), "assets": []}

    # Walk all dirs under root (including root)
    dirs = [root] + [p for p in root.iterdir() if p.is_dir()]

    for d in dirs:
        # PDFs in this dir
        for pdf in d.glob("*.pdf"):
            subdir = d / pdf.stem
            exported = export_pdf(pdf, subdir, root=root)
            catalog["assets"].extend(exported)
        # Images in this dir and its child folders (handled by loop)
        catalog["assets"].extend(catalog_images(d, root))

    # Remove duplicates by filename
    seen = set()
    uniq_assets = []
    for asset in catalog["assets"]:
        key = asset["filename"]
        if key in seen:
            continue
        seen.add(key)
        uniq_assets.append(asset)
    catalog["assets"] = uniq_assets

    gemini_key = ensure_api_key()
    if gemini_key:
        for asset in catalog["assets"]:
            describe_asset_with_gemini(asset, root, args.brand, gemini_key)
    else:
        print("[warn] GEMINI_API_KEY not found; skipping asset summaries.", file=sys.stderr)

    # Write prompt_template.txt in root
    prompt_lines = [
        f"Template Root: {root}",
        f"Brand: {args.brand}",
        "",
        "Usage guidance:",
        "- Template/background assets = base layer. Do NOT replace or ignore them.",
        "- Logo assets must be used as provided (top corner, padding).",
        "- Use user copy verbatim; no translation/rewrites.",
        "- Use relative placement descriptions; avoid numeric coordinates.",
        "- Return plain text (no Markdown/JSON) when drafting prompts.",
        "",
        "Assets:",
    ]
    for asset in catalog["assets"]:
        line = f"- {asset.get('filename')} (source: {asset.get('source')}"
        if asset.get("width") and asset.get("height"):
            line += f", {asset['width']}x{asset['height']}px"
        if asset.get("sizeKB"):
            line += f", ~{asset['sizeKB']}KB"
        line += f") :: {asset.get('description', '')}"
        if asset.get("recommendedUse"):
            line += f" | Recommended use: {asset['recommendedUse']}"
        if asset.get("layoutHints"):
            line += f" | Layout: {asset['layoutHints']}"
        if asset.get("colorPalette"):
            line += f" | Colors: {asset['colorPalette']}"
        if asset.get("copyGuidance"):
            line += f" | Copy: {asset['copyGuidance']}"
        prompt_lines.append(line)

    (root / "prompt_template.txt").write_text("\n".join(prompt_lines))

    print(json.dumps(catalog, indent=2))


if __name__ == "__main__":
    main()
