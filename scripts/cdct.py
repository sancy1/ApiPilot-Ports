"""Consumer-Driven Contract Testing for ApiPilot-Ports docs.

Extracts fenced code blocks from every Markdown file in the repo and
verifies that the documented API surface actually exists — the same
discipline as FlowSemantics' docs-snippets.py: a developer reading the
docs must be able to copy/paste imports that resolve.

Checks per language:
  - TypeScript/JavaScript: `import { a, b } from "@apipilot/<pkg>"` —
    every named import must be exported by that package's src/.
  - Python: `from apipilot.x import a` — every name must exist on the
    module (imported live from python/src).
  - Go: `httpapi.X` / `core.X` selectors — X must be an exported
    package-level declaration.

Blocks that don't reference the library are skipped. Exits 1 on any
drift so CI catches doc/API mismatches before merge.

Usage: python scripts/cdct.py
"""

from __future__ import annotations

import importlib
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "apidocs",
    "_build",
    "dist",
    ".next",
}

TS_PKGS = {"core", "node", "fastify", "hono", "next"}
GO_PKGS = {"core", "httpapi"}


# ---------------------------------------------------------------------------
# Markdown block extraction
# ---------------------------------------------------------------------------


def iter_blocks(md: Path):
    """Yield (lang, lineno, source) for each fenced block."""
    lines = md.read_text(encoding="utf-8", errors="replace").splitlines()
    in_block = False
    lang = ""
    start = 0
    buf: list[str] = []
    for i, line in enumerate(lines, 1):
        m = re.match(r"^```(\w*)", line.strip())
        if m and not in_block:
            in_block = True
            lang = m.group(1).lower()
            start = i
            buf = []
            continue
        if in_block and line.strip().startswith("```"):
            yield lang, start, "\n".join(buf)
            in_block = False
            buf = []
            continue
        if in_block:
            buf.append(line)
    if in_block and buf:
        yield lang, start, "\n".join(buf)


# ---------------------------------------------------------------------------
# TypeScript export surface
# ---------------------------------------------------------------------------

_TS_DECL_RE = re.compile(
    r"export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)"
)
_TS_EXPORT_LIST_RE = re.compile(r"export\s*\{([^}]*)\}", re.DOTALL)
_TS_STAR_RE = re.compile(r'export\s+\*\s+from\s+["\']\./([\w.-]+?)(?:\.js)?["\']')
_TS_DEFAULT_RE = re.compile(
    r"export\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z_$][\w$]*)?"
)


def _ts_file_exports(path: Path, seen: set[Path]) -> set[str]:
    if path in seen or not path.is_file():
        return set()
    seen.add(path)
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    names = {m.group(1) for m in _TS_DECL_RE.finditer(text)}
    for m in _TS_EXPORT_LIST_RE.finditer(text):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            # "a as b" exports b; "type a" exports a
            part = re.sub(r"^type\s+", "", part)
            if " as " in part:
                part = part.split(" as ")[-1].strip()
            if re.match(r"^[A-Za-z_$][\w$]*$", part):
                names.add(part)
    for m in _TS_DEFAULT_RE.finditer(text):
        if m.group(1):
            names.add(m.group(1))
        else:
            names.add("default")
    # Recurse into export * from "./x.js"
    for m in _TS_STAR_RE.finditer(text):
        target = path.parent / (m.group(1) + ".ts")
        names |= _ts_file_exports(target, seen)
    return names


def ts_exports(pkg: str) -> set[str]:
    src = ROOT / "typescript" / pkg / "src"
    if not src.is_dir():
        return set()
    names: set[str] = set()
    for f in src.rglob("*.ts"):
        names |= _ts_file_exports(f, set())
    return names


_TS_IMPORT_RE = re.compile(
    r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*[\"'](@apipilot/[\w-]+)[\"']"
)
_TS_DEFAULT_IMPORT_RE = re.compile(
    r"import\s+([A-Za-z_$][\w$]*)\s+from\s*[\"'](@apipilot/[\w-]+)[\"']"
)


def check_ts_block(source: str, origin: str, errors: list[str]) -> int:
    checked = 0
    for m in _TS_IMPORT_RE.finditer(source):
        pkg = m.group(2).split("/")[-1]
        if pkg not in TS_PKGS:
            continue
        exports = ts_exports(pkg)
        for raw in m.group(1).split(","):
            name = raw.strip()
            if not name:
                continue
            name = re.sub(r"^type\s+", "", name)
            if " as " in name:
                name = name.split(" as ")[0].strip()
            checked += 1
            if name not in exports:
                errors.append(f"{origin}: @apipilot/{pkg} does not export {name!r}")
    for m in _TS_DEFAULT_IMPORT_RE.finditer(source):
        pkg = m.group(2).split("/")[-1]
        if pkg not in TS_PKGS:
            continue
        checked += 1
        if "default" not in ts_exports(pkg):
            errors.append(f"{origin}: @apipilot/{pkg} has no default export")
    return checked


# ---------------------------------------------------------------------------
# Python import surface
# ---------------------------------------------------------------------------

_PY_FROM_RE = re.compile(
    r"from\s+(apipilot(?:\.\w+)*)\s+import\s+\(([^)]+)\)|"
    r"from\s+(apipilot(?:\.\w+)*)\s+import\s+([\w, ]+)"
)


def check_py_block(source: str, origin: str, errors: list[str]) -> int:
    checked = 0
    sys.path.insert(0, str(ROOT / "python" / "src"))
    try:
        for m in _PY_FROM_RE.finditer(source):
            module_name = m.group(1) or m.group(3)
            names_raw = m.group(2) or m.group(4) or ""
            try:
                mod = importlib.import_module(module_name)
            except Exception as exc:  # noqa: BLE001 — report any import failure as drift
                errors.append(f"{origin}: cannot import {module_name}: {exc}")
                continue
            for raw in names_raw.replace("\n", " ").split(","):
                name = raw.strip()
                if not name or name == "*":
                    continue
                name = name.split(" as ")[0].strip()
                if not re.match(r"^\w+$", name):
                    continue
                checked += 1
                if not hasattr(mod, name):
                    errors.append(f"{origin}: {module_name} has no attribute {name!r}")
    finally:
        sys.path.remove(str(ROOT / "python" / "src"))
    return checked


# ---------------------------------------------------------------------------
# Go selector surface
# ---------------------------------------------------------------------------

_GO_DECL_RE = re.compile(
    r"^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)|^type\s+([A-Z]\w*)|"
    r"^var\s+([A-Z]\w*)|^const\s+([A-Z]\w*)",
    re.MULTILINE,
)
_GO_CONST_BLOCK_RE = re.compile(r"^const\s*\(([^)]*)\)", re.MULTILINE | re.DOTALL)
_GO_SELECTOR_RE = re.compile(r"\b(httpapi|core)\.([A-Z]\w*)")


def go_exports(pkg: str) -> set[str]:
    names: set[str] = set()
    pkg_dir = ROOT / "go" / pkg
    if not pkg_dir.is_dir():
        return names
    for f in pkg_dir.glob("*.go"):
        if f.name.endswith("_test.go"):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in _GO_DECL_RE.finditer(text):
            for g in m.groups():
                if g:
                    names.add(g)
        # const ( ... ) blocks: capture exported identifiers, typed or not
        for cb in _GO_CONST_BLOCK_RE.finditer(text):
            for line in cb.group(1).splitlines():
                line = line.split("//")[0].strip()
                mm = re.match(r"^([A-Z]\w*)\s*(?:[\w\[\]\.*]+\s*)?=", line)
                if mm:
                    names.add(mm.group(1))
    return names


def check_go_block(source: str, origin: str, errors: list[str]) -> int:
    checked = 0
    for m in _GO_SELECTOR_RE.finditer(source):
        pkg, name = m.group(1), m.group(2)
        checked += 1
        if name not in go_exports(pkg):
            errors.append(f"{origin}: go/{pkg} does not export {name!r}")
    return checked


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main() -> int:
    errors: list[str] = []
    checked = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            md = Path(dirpath) / fname
            rel = md.relative_to(ROOT).as_posix()
            for lang, lineno, source in iter_blocks(md):
                origin = f"{rel}:{lineno}"
                if (
                    lang in ("ts", "typescript", "tsx", "js", "javascript", "jsx")
                    and "@apipilot/" in source
                ):
                    checked += check_ts_block(source, origin, errors)
                elif lang in ("python", "py") and "apipilot" in source:
                    checked += check_py_block(source, origin, errors)
                elif lang in ("go", "golang") and re.search(
                    r"\b(?:httpapi|core)\.[A-Z]", source
                ):
                    checked += check_go_block(source, origin, errors)

    if errors:
        print("CDCT FAILED — documented API does not exist:\n")
        for e in errors:
            print(f"  {e}")
        print(f"\n{len(errors)} drift(s) across {checked} checked references.")
        return 1
    print(f"CDCT passed — {checked} documented API references resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
