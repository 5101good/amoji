#!/usr/bin/env python3
"""Author, build and verify Amoji 0.1 expression packs (.amoji).

Subcommands:
  acts     List the core act registry in one locale.
  init     Scaffold a pack source directory (pack.json + images/).
  build    Validate a source directory, normalize art, write a deterministic .amoji.
  check    Verify an existing .amoji archive against the 0.1 rules.
  preview  Render a numbered contact sheet PNG for human review.

Requires Python 3.9+ and Pillow. The rules mirror docs/specs/amoji-0.1-rfc.md.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - exercised only without Pillow
    sys.exit("Pillow is required: python3 -m pip install pillow")

HERE = Path(__file__).resolve().parent
REGISTRY = json.loads((HERE.parent / "references" / "registry.json").read_text("utf-8"))
ACTS = {a["act"]: a for a in REGISTRY["acts"]}

PROTOCOL = "0.1"
LOCALE = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
UUID4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
STATIC_MIME = {"image/png", "image/jpeg", "image/webp"}
TRANSLATION_METHODS = {"human", "machine", "machine-reviewed"}
CONFLICT_GROUPS = {"explanation", "response-organization", "completion-report", "handoff"}
TEMPLATES = {
    "response-organization@1": {"layout": {"answer-first", "concise", "example-first"}},
    "completion-self-check@1": {"evidence": {"required"}, "unknowns": {"explicit"}},
}
# Fields only the registry may define (RFC §6, P3).
REGISTRY_ONLY = {"authority", "expects", "forms", "pressure_sensitive", "grounded"}

KIB = 1024
MIB = 1024 * KIB
LIMITS = {
    "pack_name": 60, "pack_description": 280, "name": 40, "meaning": 240, "fallback": 80,
    "situations": 4, "situation": 64, "tags": 8, "tag": 32, "license": 120, "creator": 120,
    "source": 500, "expressions": 200, "effects": 64, "effect_refs": 3,
    "text_bytes": 16 * KIB, "instruction_bytes": 2 * KIB, "summary_bytes": 4 * KIB,
    "blob_bytes": 10 * MIB, "dimension": 2048, "archive_bytes": 10 * MIB, "expanded_bytes": 64 * MIB,
}
ZIP_TIME = (2026, 1, 1, 0, 0, 0)


class Problems:
    """Collects every rule violation so one run reports them all."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def warn(self, where: str, message: str) -> None:
        self.warnings.append(f"{where}: {message}")


def derived_uuid(*parts: str) -> str:
    """Deterministic UUIDv4-shaped id, so rebuilding identical content yields identical ids."""
    raw = bytearray(hashlib.sha256("\x1f".join(parts).encode("utf-8")).digest()[:16])
    raw[6] = (raw[6] & 0x0F) | 0x40
    raw[8] = (raw[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(raw)))


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def nfc(value):
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [nfc(v) for v in value]
    if isinstance(value, dict):
        return {k: nfc(v) for k, v in value.items()}
    return value


def gloss(entry: dict, direction: str, locale: str) -> str:
    texts = entry["forms"][direction]["gloss"]
    return texts.get(locale) or texts.get(locale.split("-")[0]) or texts["en"]


# --------------------------------------------------------------------------- validation

def check_keys(p: Problems, where: str, obj, required: set, optional: set = frozenset()) -> bool:
    if not isinstance(obj, dict):
        p.error(where, "must be an object")
        return False
    for key in required - obj.keys():
        p.error(where, f"missing required field '{key}'")
    for key in obj.keys() - required - set(optional):
        if key in REGISTRY_ONLY:
            p.error(where, f"'{key}' is defined only by the act registry and must not appear in packs")
        else:
            p.error(where, f"unknown field '{key}'")
    return True


def check_text(p: Problems, where: str, value, limit: int) -> None:
    if not isinstance(value, str) or not value.strip():
        p.error(where, "must be a non-empty string")
        return
    if unicodedata.normalize("NFC", value) != value:
        p.error(where, "must be Unicode NFC normalized")
    if len(value) > limit:
        p.error(where, f"is {len(value)} code points; limit is {limit}")


def check_text_list(p: Problems, where: str, value, max_items: int, limit: int) -> None:
    if not isinstance(value, list) or len(value) > max_items:
        p.error(where, f"must be a list of at most {max_items} strings")
        return
    if len(set(value)) != len(value):
        p.error(where, "items must be unique")
    for i, item in enumerate(value):
        check_text(p, f"{where}[{i}]", item, limit)


def check_locale(p: Problems, where: str, value) -> bool:
    if not isinstance(value, str) or not LOCALE.match(value):
        p.error(where, f"'{value}' is not a BCP 47 language tag")
        return False
    return True


def check_localized(p: Problems, where: str, value, locales: list[str], original: str, limit: int) -> None:
    if not isinstance(value, dict) or not value:
        p.error(where, "must be a map of language tag to text")
        return
    for locale, text in value.items():
        if check_locale(p, f"{where} key", locale):
            check_text(p, f"{where}.{locale}", text, limit)
    for locale in {original, *locales} - value.keys():
        p.error(where, f"missing language '{locale}'")


def check_uuid(p: Problems, where: str, value) -> None:
    if not isinstance(value, str) or not UUID4.match(value):
        p.error(where, "must be a lowercase UUIDv4")


def check_blob(p: Problems, where: str, blob, mimes: set) -> None:
    if not check_keys(p, where, blob, {"sha256", "mime", "bytes", "width", "height"}):
        return
    if not isinstance(blob.get("sha256"), str) or not SHA256.match(blob["sha256"]):
        p.error(f"{where}.sha256", "must be 64 lowercase hex characters")
    if blob.get("mime") not in mimes:
        p.error(f"{where}.mime", f"must be one of {sorted(mimes)}")
    size = blob.get("bytes")
    if not isinstance(size, int) or not 1 <= size <= LIMITS["blob_bytes"]:
        p.error(f"{where}.bytes", f"must be 1..{LIMITS['blob_bytes']}")
    for axis in ("width", "height"):
        v = blob.get(axis)
        if not isinstance(v, int) or not 1 <= v <= LIMITS["dimension"]:
            p.error(f"{where}.{axis}", f"must be 1..{LIMITS['dimension']}")


def check_rights(p: Problems, where: str, rights) -> None:
    if check_keys(p, where, rights, {"license"}, {"creator", "source"}):
        for key in ("license", "creator", "source"):
            if key in rights:
                check_text(p, f"{where}.{key}", rights[key], LIMITS[key])


def check_expression(p: Problems, where: str, e, pack_locales: list[str]) -> None:
    required = {"kind", "amoji", "asset_id", "revision_id", "realizes", "intensity", "original_locale",
                "name", "semantics", "visual", "rights", "created_at"}
    if not check_keys(p, where, e, required, {"directions", "tags"}):
        return
    if e.get("kind") != "amoji.expression":
        p.error(f"{where}.kind", "must be 'amoji.expression'")
    if e.get("amoji") != PROTOCOL:
        p.error(f"{where}.amoji", f"must be '{PROTOCOL}'")
    check_uuid(p, f"{where}.asset_id", e.get("asset_id"))
    check_uuid(p, f"{where}.revision_id", e.get("revision_id"))
    act = ACTS.get(e.get("realizes"))
    if act is None:
        p.error(f"{where}.realizes", f"'{e.get('realizes')}' is not a core act; run 'acts' to list them")
    elif act.get("status") == "deprecated":
        p.warn(f"{where}.realizes", f"'{act['act']}' is deprecated")
    if e.get("intensity") not in (1, 2, 3):
        p.error(f"{where}.intensity", "must be 1, 2 or 3")
    if "directions" in e:
        dirs = e["directions"]
        allowed = set(act["forms"]) if act else {"h2a", "a2h"}
        if not isinstance(dirs, list) or not dirs or len(set(dirs)) != len(dirs) or not set(dirs) <= allowed:
            p.error(f"{where}.directions", f"must be a non-empty unique subset of {sorted(allowed)}")
    original = e.get("original_locale")
    check_locale(p, f"{where}.original_locale", original)
    check_localized(p, f"{where}.name", e.get("name"), pack_locales, original, LIMITS["name"])

    semantics = e.get("semantics")
    if not isinstance(semantics, dict):
        p.error(f"{where}.semantics", "must be a map of language tag to semantics")
        semantics = {}
    for locale in {original, *pack_locales} - semantics.keys():
        p.error(f"{where}.semantics", f"missing language '{locale}'")
    for locale, s in semantics.items():
        w = f"{where}.semantics.{locale}"
        if not check_locale(p, w, locale):
            continue
        opt = {"use_when", "avoid_when"} | ({"translation"} if locale != original else set())
        if locale != original and isinstance(s, dict) and "translation" not in s:
            p.error(w, "a non-original language must declare 'translation' {from, method}")
        if not check_keys(p, w, s, {"meaning", "fallback"}, opt):
            continue
        check_text(p, f"{w}.meaning", s.get("meaning"), LIMITS["meaning"])
        check_text(p, f"{w}.fallback", s.get("fallback"), LIMITS["fallback"])
        for key in ("use_when", "avoid_when"):
            if key in s:
                check_text_list(p, f"{w}.{key}", s[key], LIMITS["situations"], LIMITS["situation"])
        if "translation" in s and check_keys(p, f"{w}.translation", s["translation"], {"from", "method"}):
            t = s["translation"]
            if t.get("from") not in semantics or t.get("from") == locale:
                p.error(f"{w}.translation.from", "must name another language present in semantics")
            if t.get("method") not in TRANSLATION_METHODS:
                p.error(f"{w}.translation.method", f"must be one of {sorted(TRANSLATION_METHODS)}")

    if "tags" in e:
        if not isinstance(e["tags"], dict):
            p.error(f"{where}.tags", "must be a map of language tag to a tag list")
        else:
            for locale, tags in e["tags"].items():
                if check_locale(p, f"{where}.tags key", locale):
                    check_text_list(p, f"{where}.tags.{locale}", tags, LIMITS["tags"], LIMITS["tag"])

    text_budget = len(canonical({k: e.get(k) for k in ("name", "semantics", "tags")}).encode("utf-8"))
    if text_budget > LIMITS["text_bytes"]:
        p.error(where, f"name, semantics and tags take {text_budget} bytes; limit is {LIMITS['text_bytes']}")

    visual = e.get("visual")
    if check_keys(p, f"{where}.visual", visual, {"primary", "animated", "text_locale"}, {"duration_ms", "poster"}):
        animated = visual.get("animated")
        if not isinstance(animated, bool):
            p.error(f"{where}.visual.animated", "must be true or false")
        check_blob(p, f"{where}.visual.primary", visual.get("primary"),
                   {"image/gif", "image/webp"} if animated else STATIC_MIME)
        if animated:
            if not isinstance(visual.get("duration_ms"), int) or not 1 <= visual["duration_ms"] <= 10000:
                p.error(f"{where}.visual.duration_ms", "animated art needs duration_ms 1..10000")
            if "poster" not in visual:
                p.error(f"{where}.visual.poster", "animated art needs a static poster")
            else:
                check_blob(p, f"{where}.visual.poster", visual["poster"], STATIC_MIME)
        elif "duration_ms" in visual or "poster" in visual:
            p.error(f"{where}.visual", "static art must not declare duration_ms or poster")
        if visual.get("text_locale") is not None:
            check_locale(p, f"{where}.visual.text_locale", visual["text_locale"])
    check_rights(p, f"{where}.rights", e.get("rights"))
    if not isinstance(e.get("created_at"), str) or not e["created_at"].endswith("Z"):
        p.error(f"{where}.created_at", "must be an RFC 3339 UTC timestamp ending in Z")


def check_effects(p: Problems, manifest: dict, locales: list[str], original: str) -> set:
    ids = set()
    effects = manifest.get("effects", [])
    if not isinstance(effects, list) or len(effects) > LIMITS["effects"]:
        p.error("effects", f"must be a list of at most {LIMITS['effects']} effects")
        return ids
    for i, fx in enumerate(effects):
        w = f"effects[{i}]"
        kind = fx.get("kind") if isinstance(fx, dict) else None
        base = {"effect_id", "effect_revision_id", "kind", "title", "summary"}
        extra = {"conflict_group", "instruction"} if kind == "context" else {"template", "config"}
        if not check_keys(p, w, fx, base | extra):
            continue
        check_uuid(p, f"{w}.effect_id", fx.get("effect_id"))
        check_uuid(p, f"{w}.effect_revision_id", fx.get("effect_revision_id"))
        ids.add(fx.get("effect_id"))
        check_localized(p, f"{w}.title", fx.get("title"), locales, original, LIMITS["pack_name"])
        if isinstance(fx.get("summary"), dict):
            for locale, text in fx["summary"].items():
                if len(str(text).encode("utf-8")) > LIMITS["summary_bytes"]:
                    p.error(f"{w}.summary.{locale}", "exceeds 4 KiB")
        check_localized(p, f"{w}.summary", fx.get("summary"), locales, original, 10**6)
        if kind == "context":
            if fx.get("conflict_group") not in CONFLICT_GROUPS:
                p.error(f"{w}.conflict_group", f"must be one of {sorted(CONFLICT_GROUPS)}")
            check_localized(p, f"{w}.instruction", fx.get("instruction"), [], original, 10**6)
            for locale, text in (fx.get("instruction") or {}).items():
                if len(str(text).encode("utf-8")) > LIMITS["instruction_bytes"]:
                    p.error(f"{w}.instruction.{locale}", "exceeds 2 KiB")
        elif kind == "template":
            schema = TEMPLATES.get(fx.get("template"))
            if schema is None:
                p.error(f"{w}.template", f"must be one of {sorted(TEMPLATES)}")
            elif not isinstance(fx.get("config"), dict) or fx["config"].keys() != schema.keys() or any(
                    fx["config"][k] not in v for k, v in schema.items()):
                p.error(f"{w}.config", f"does not match {fx['template']}")
        else:
            p.error(f"{w}.kind", "must be 'context' or 'template'")
    return ids


def check_bindings(p: Problems, manifest: dict, effect_ids: set, refs: set) -> None:
    for i, b in enumerate(manifest.get("bindings", [])):
        w = f"bindings[{i}]"
        if not check_keys(p, w, b, {"target", "effects"}):
            continue
        target = b.get("target")
        if isinstance(target, dict) and set(target) == {"act"}:
            if target["act"] not in ACTS:
                p.error(f"{w}.target.act", "is not a core act")
        elif isinstance(target, dict) and set(target) == {"asset_id", "revision_id"}:
            if (target["asset_id"], target["revision_id"]) not in refs:
                p.error(f"{w}.target", "does not reference an expression in this pack")
        else:
            p.error(f"{w}.target", "must be {act} or {asset_id, revision_id}")
        fx = b.get("effects")
        if not isinstance(fx, list) or not 1 <= len(fx) <= LIMITS["effect_refs"] or not set(fx) <= effect_ids:
            p.error(f"{w}.effects", f"must list 1..{LIMITS['effect_refs']} effect ids defined in this pack")


def validate_manifest(manifest) -> Problems:
    p = Problems()
    required = {"kind", "amoji", "pack_id", "release_id", "version", "original_locale", "locales",
                "name", "description", "expressions", "rights"}
    if not check_keys(p, "pack", manifest, required, {"effects", "bindings", "derived_from"}):
        return p
    if manifest.get("kind") != "amoji.pack":
        p.error("pack.kind", "must be 'amoji.pack'")
    if manifest.get("amoji") != PROTOCOL:
        p.error("pack.amoji", f"must be '{PROTOCOL}'")
    check_uuid(p, "pack.pack_id", manifest.get("pack_id"))
    check_uuid(p, "pack.release_id", manifest.get("release_id"))
    if not isinstance(manifest.get("version"), int) or manifest["version"] < 1:
        p.error("pack.version", "must be a positive integer")
    original = manifest.get("original_locale")
    check_locale(p, "pack.original_locale", original)
    locales = manifest.get("locales")
    if not isinstance(locales, list) or len(set(locales)) != len(locales) or original not in locales:
        p.error("pack.locales", "must be a unique list that includes original_locale")
        locales = [original]
    for loc in locales:
        check_locale(p, "pack.locales", loc)
    check_localized(p, "pack.name", manifest.get("name"), locales, original, LIMITS["pack_name"])
    check_localized(p, "pack.description", manifest.get("description"), locales, original,
                    LIMITS["pack_description"])
    check_rights(p, "pack.rights", manifest.get("rights"))
    if "derived_from" in manifest and check_keys(p, "pack.derived_from", manifest["derived_from"],
                                                 {"pack_id", "release_id"}):
        check_uuid(p, "pack.derived_from.pack_id", manifest["derived_from"].get("pack_id"))
        check_uuid(p, "pack.derived_from.release_id", manifest["derived_from"].get("release_id"))
    expressions = manifest.get("expressions")
    if not isinstance(expressions, list) or not 1 <= len(expressions) <= LIMITS["expressions"]:
        p.error("pack.expressions", f"must contain 1..{LIMITS['expressions']} expressions")
        expressions = []
    seen = set()
    for i, e in enumerate(expressions):
        check_expression(p, f"expressions[{i}]", e, locales)
        if isinstance(e, dict):
            if e.get("asset_id") in seen:
                p.error(f"expressions[{i}].asset_id", "each asset appears exactly once per release")
            seen.add(e.get("asset_id"))
    refs = {(e.get("asset_id"), e.get("revision_id")) for e in expressions if isinstance(e, dict)}
    check_bindings(p, manifest, check_effects(p, manifest, locales, original), refs)
    return p


def blobs_of(manifest: dict) -> dict:
    out = {}
    for e in manifest.get("expressions", []):
        visual = e.get("visual", {}) if isinstance(e, dict) else {}
        for key in ("primary", "poster"):
            blob = visual.get(key)
            if isinstance(blob, dict) and isinstance(blob.get("sha256"), str):
                out[blob["sha256"]] = blob
    return out


def check_image(p: Problems, where: str, data: bytes, blob: dict, animated: bool | None) -> None:
    if hashlib.sha256(data).hexdigest() != blob.get("sha256"):
        p.error(where, "content does not match its sha256")
    if len(data) != blob.get("bytes"):
        p.error(where, f"is {len(data)} bytes but manifest says {blob.get('bytes')}")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            if MIME.get(img.format) != blob.get("mime"):
                p.error(where, f"decodes as {img.format}, not {blob.get('mime')}")
            if img.size != (blob.get("width"), blob.get("height")):
                p.error(where, f"is {img.size[0]}x{img.size[1]}, manifest says {blob.get('width')}x{blob.get('height')}")
            frames = getattr(img, "n_frames", 1)
            if animated is False and frames > 1:
                p.error(where, "is animated but the expression is declared static")
            if animated is True and frames < 2:
                p.error(where, "is declared animated but has a single frame")
    except Exception as exc:  # Pillow raises many decoder-specific types
        p.error(where, f"cannot be decoded: {exc}")


def check_archive(data: bytes) -> tuple[Problems, dict | None]:
    p = Problems()
    if len(data) > LIMITS["archive_bytes"]:
        p.error("archive", f"is {len(data)} bytes; the market limit is {LIMITS['archive_bytes']}")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        p.error("archive", f"is not a ZIP file: {exc}")
        return p, None
    with archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(set(names)) != len(names):
            p.error("archive", "contains duplicate entry names")
        expanded = sum(i.file_size for i in infos)
        if expanded > LIMITS["expanded_bytes"]:
            p.error("archive", f"expands to {expanded} bytes; limit is {LIMITS['expanded_bytes']}")
            return p, None
        for name in names:
            if name != "manifest.json" and not re.fullmatch(r"blobs/[0-9a-f]{64}", name):
                p.error("archive", f"unexpected entry '{name}'")
        bad = archive.testzip()
        if bad:
            p.error("archive", f"CRC check failed for '{bad}'")
            return p, None
        if "manifest.json" not in names:
            p.error("archive", "missing manifest.json")
            return p, None
        try:
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            p.error("manifest.json", f"is not UTF-8 JSON: {exc}")
            return p, None
        mp = validate_manifest(manifest)
        p.errors += mp.errors
        p.warnings += mp.warnings
        blobs = blobs_of(manifest)
        present = {n[len("blobs/"):] for n in names if n.startswith("blobs/")}
        for sha in present - blobs.keys():
            p.error("archive", f"blob {sha} is not referenced by the manifest")
        for sha in blobs.keys() - present:
            p.error("archive", f"blob {sha} referenced by the manifest is missing")
        for e in manifest.get("expressions", []):
            visual = e.get("visual", {}) if isinstance(e, dict) else {}
            for key, animated in (("primary", visual.get("animated")), ("poster", False)):
                blob = visual.get(key)
                if isinstance(blob, dict) and blob.get("sha256") in present:
                    check_image(p, f"blobs/{blob['sha256']}", archive.read(f"blobs/{blob['sha256']}"), blob, animated)
        return p, manifest


# --------------------------------------------------------------------------- build

def normalize_art(path: Path, size: int, resample: str, where: str, p: Problems) -> bytes | None:
    try:
        with Image.open(path) as img:
            if getattr(img, "n_frames", 1) > 1:
                p.error(where, "animated source art is not supported by this tool; provide a static image")
                return None
            rgba = img.convert("RGBA")
    except FileNotFoundError:
        p.error(where, f"image not found: {path}")
        return None
    except Exception as exc:
        p.error(where, f"cannot be decoded: {exc}")
        return None
    lo, hi = rgba.getchannel("A").getextrema()
    if lo == 255:
        p.warn(where, "has no transparent pixels; transparent backgrounds read best in chat")
    filt = Image.Resampling.NEAREST if resample == "nearest" else Image.Resampling.LANCZOS
    scale = min(size / rgba.width, size / rgba.height)
    fitted = rgba.resize((max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale))), filt)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    out = io.BytesIO()
    if resample == "nearest":
        canvas.save(out, "WEBP", lossless=True, method=6)
    else:
        canvas.save(out, "WEBP", quality=94, alpha_quality=100, method=4)
    return out.getvalue()


def build(source_dir: Path) -> tuple[Problems, dict | None, dict]:
    p = Problems()
    try:
        src = nfc(json.loads((source_dir / "pack.json").read_text("utf-8")))
    except FileNotFoundError:
        p.error("pack.json", f"not found in {source_dir}; run 'init' first")
        return p, None, {}
    except json.JSONDecodeError as exc:
        p.error("pack.json", f"invalid JSON: {exc}")
        return p, None, {}
    required = {"pack_id", "slug", "version", "created_at", "original_locale", "locales", "name",
                "description", "rights", "expressions"}
    if not check_keys(p, "pack.json", src, required, {"derived_from", "image"}):
        return p, None, {}
    if not isinstance(src.get("slug"), str) or not SLUG.match(src["slug"]):
        p.error("pack.json.slug", "must be lowercase letters, digits and hyphens")
    image_opts = src.get("image", {})
    if not check_keys(p, "pack.json.image", image_opts, set(), {"size", "resample"}):
        image_opts = {}
    size = image_opts.get("size", 512)
    resample = image_opts.get("resample", "lanczos")
    if size not in (256, 384, 512, 768, 1024) or resample not in ("lanczos", "nearest"):
        p.error("pack.json.image", "size must be 256/384/512/768/1024 and resample lanczos or nearest")
    pack_id = src.get("pack_id")
    check_uuid(p, "pack.json.pack_id", pack_id)

    blobs: dict[str, bytes] = {}
    expressions, slugs = [], set()
    for i, item in enumerate(src.get("expressions") or []):
        w = f"pack.json.expressions[{i}]"
        if not check_keys(p, w, item, {"slug", "realizes", "intensity", "image", "text_locale", "name",
                                       "semantics"}, {"directions", "tags"}):
            continue
        slug = item.get("slug")
        if not isinstance(slug, str) or not SLUG.match(slug) or slug in slugs:
            p.error(f"{w}.slug", "must be a unique lowercase slug")
        slugs.add(slug)
        data = normalize_art(source_dir / str(item.get("image")), size, resample, f"{w}.image", p)
        primary = {"sha256": "0" * 64, "mime": "image/webp", "bytes": 1, "width": size, "height": size}
        if data is not None:
            primary = {"sha256": hashlib.sha256(data).hexdigest(), "mime": "image/webp",
                       "bytes": len(data), "width": size, "height": size}
            blobs[primary["sha256"]] = data
        expression = {
            "kind": "amoji.expression", "amoji": PROTOCOL,
            "asset_id": derived_uuid("amoji-asset", str(pack_id), str(slug)),
            "realizes": item.get("realizes"), "intensity": item.get("intensity"),
            **({"directions": item["directions"]} if "directions" in item else {}),
            "original_locale": src.get("original_locale"),
            "name": item.get("name"), "semantics": item.get("semantics"),
            **({"tags": item["tags"]} if "tags" in item else {}),
            "visual": {"primary": primary, "animated": False, "text_locale": item.get("text_locale")},
            "rights": src.get("rights"), "created_at": src.get("created_at"),
        }
        expression["revision_id"] = derived_uuid("amoji-revision", canonical(expression))
        expressions.append(expression)

    manifest = {
        "kind": "amoji.pack", "amoji": PROTOCOL, "pack_id": pack_id,
        "version": src.get("version"), "original_locale": src.get("original_locale"),
        "locales": src.get("locales"), "name": src.get("name"), "description": src.get("description"),
        "expressions": expressions, "rights": src.get("rights"),
        **({"derived_from": src["derived_from"]} if "derived_from" in src else {}),
    }
    manifest["release_id"] = derived_uuid("amoji-release", canonical(manifest))
    mp = validate_manifest(manifest)
    p.errors += mp.errors
    p.warnings += mp.warnings
    return p, manifest, blobs


def write_archive(manifest: dict, blobs: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        entries = [("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))]
        entries += [(f"blobs/{sha}", blobs[sha]) for sha in sorted(blobs)]
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return out.getvalue()


# --------------------------------------------------------------------------- commands

def report(p: Problems) -> None:
    for w in p.warnings:
        print(f"warning: {w}", file=sys.stderr)
    for e in p.errors:
        print(f"error: {e}", file=sys.stderr)


def summary(manifest: dict) -> dict:
    acts = sorted({e["realizes"] for e in manifest["expressions"]})
    return {
        "pack_id": manifest["pack_id"], "release_id": manifest["release_id"], "version": manifest["version"],
        "name": manifest["name"], "locales": manifest["locales"], "expressions": len(manifest["expressions"]),
        "acts": acts, "acts_not_covered": sorted(set(ACTS) - set(acts)),
    }


def cmd_acts(args) -> int:
    for entry in REGISTRY["acts"]:
        flags = "".join(f for f, on in (("R", entry["authority"] == "reduce"), ("G", entry["grounded"]),
                                        ("P", entry["pressure_sensitive"])) if on)
        forms = "  ".join(f"{d}:{f['expects']} «{gloss(entry, d, args.locale)}»" for d, f in entry["forms"].items())
        print(f"{entry['act']:<24} {entry['family']:<10} {flags:<3} {forms}")
    return 0


def cmd_init(args) -> int:
    target = Path(args.dir)
    if (target / "pack.json").exists():
        print(f"error: {target / 'pack.json'} already exists", file=sys.stderr)
        return 1
    if not SLUG.match(args.slug):
        print("error: --slug must be lowercase letters, digits and hyphens", file=sys.stderr)
        return 1
    locales = list(dict.fromkeys([args.locale, *[l for l in args.locales.split(",") if l]]))
    (target / "images").mkdir(parents=True, exist_ok=True)
    pack = {
        "pack_id": str(uuid.uuid4()),
        "slug": args.slug, "version": 1,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "original_locale": args.locale, "locales": locales,
        "name": {l: "" for l in locales}, "description": {l: "" for l in locales},
        "rights": {"license": args.license, **({"creator": args.creator} if args.creator else {})},
        "image": {"size": 512, "resample": "lanczos"},
        "expressions": [],
    }
    (target / "pack.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"created {target / 'pack.json'} (pack_id {pack['pack_id']}); keep this pack_id for every future version")
    return 0


def cmd_build(args) -> int:
    source = Path(args.dir)
    p, manifest, blobs = build(source)
    report(p)
    if p.errors or manifest is None:
        print(f"build failed with {len(p.errors)} error(s)", file=sys.stderr)
        return 1
    data = write_archive(manifest, blobs)
    cp, _ = check_archive(data)
    if cp.errors:
        report(cp)
        return 1
    out = Path(args.output or source / "dist" / f"{json.loads((source / 'pack.json').read_text('utf-8'))['slug']}.amoji")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    out.with_suffix(".manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps({"output": str(out), "bytes": len(data), **summary(manifest)}, ensure_ascii=False, indent=2))
    return 0


def cmd_check(args) -> int:
    p, manifest = check_archive(Path(args.file).read_bytes())
    report(p)
    if p.errors or manifest is None:
        print(f"check failed with {len(p.errors)} error(s)", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, **summary(manifest)}, ensure_ascii=False, indent=2))
    return 0


def cmd_preview(args) -> int:
    path = Path(args.source)
    if path.is_dir():
        p, manifest, blobs = build(path)
        if manifest is None or not blobs:
            report(p)
            return 1
    else:
        p, manifest = check_archive(path.read_bytes())
        if manifest is None:
            report(p)
            return 1
        with zipfile.ZipFile(path) as archive:
            blobs = {n[len("blobs/"):]: archive.read(n) for n in archive.namelist() if n.startswith("blobs/")}
    cell, cols = 200, 4
    items = manifest["expressions"]
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * (cell + 20)), (245, 245, 245, 255))
    draw = ImageDraw.Draw(sheet)
    locale = args.locale or manifest["original_locale"]
    for i, e in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * (cell + 20)
        data = blobs.get(e["visual"]["primary"]["sha256"])
        if data:
            with Image.open(io.BytesIO(data)) as img:
                thumb = img.convert("RGBA")
                thumb.thumbnail((cell - 16, cell - 16))
                sheet.alpha_composite(thumb, (x + (cell - thumb.width) // 2, y + 8))
        draw.text((x + 8, y + cell), f"{i + 1}. {e['realizes'].split(':')[1]}", fill=(40, 40, 40, 255))
        name = e["name"].get(locale) or e["name"][e["original_locale"]]
        print(f"{i + 1:>3}. {e['realizes']:<24} {name}")
    out = Path(args.output)
    sheet.convert("RGB").save(out, "PNG")
    print(f"wrote {out}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    a = sub.add_parser("acts", help="list the core act registry")
    a.add_argument("--locale", default="en")
    a.set_defaults(func=cmd_acts)
    i = sub.add_parser("init", help="scaffold a pack source directory")
    i.add_argument("dir")
    i.add_argument("--slug", required=True)
    i.add_argument("--locale", default="zh-CN", help="original language of the semantics")
    i.add_argument("--locales", default="en", help="extra complete languages, comma separated")
    i.add_argument("--license", default="CC0-1.0")
    i.add_argument("--creator")
    i.set_defaults(func=cmd_init)
    b = sub.add_parser("build", help="validate and package a source directory")
    b.add_argument("dir")
    b.add_argument("-o", "--output")
    b.set_defaults(func=cmd_build)
    c = sub.add_parser("check", help="verify an .amoji archive")
    c.add_argument("file")
    c.set_defaults(func=cmd_check)
    v = sub.add_parser("preview", help="render a numbered contact sheet")
    v.add_argument("source", help="pack source directory or .amoji file")
    v.add_argument("-o", "--output", default="preview.png")
    v.add_argument("--locale")
    v.set_defaults(func=cmd_preview)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
