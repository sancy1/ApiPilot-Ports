"""Check that generated API docs are fresh (single-source-of-truth gate).

Regenerates every port's API docs into a temp directory and compares the
result against the committed/generated output. Exits non-zero on any
difference — run this in CI after doc-comment changes.

Usage: python scripts/check_docs.py
"""

from __future__ import annotations

import filecmp
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def tree_files(directory: Path) -> dict[str, Path]:
    """Map relative posix paths to files, skipping noise."""
    out: dict[str, Path] = {}
    if not directory.is_dir():
        return out
    for p in directory.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(directory).as_posix()
        if (
            rel.endswith((".pyc", ".DS_Store"))
            or "__pycache__" in rel
            or rel.startswith(".doctrees/")
        ):
            continue
        out[rel] = p
    return out


def diff_trees(
    label: str,
    expected_dir: Path,
    actual_dir: Path,
    only: set[str] | None = None,
    exclude: set[str] | None = None,
) -> list[str]:
    """Compare two directory trees; return human-readable differences."""
    expected = tree_files(expected_dir)
    actual = tree_files(actual_dir)
    if only is not None:
        expected = {k: v for k, v in expected.items() if k in only}
        actual = {k: v for k, v in actual.items() if k in only}
    if exclude is not None:
        expected = {k: v for k, v in expected.items() if k not in exclude}
        actual = {k: v for k, v in actual.items() if k not in exclude}
    problems: list[str] = []
    for rel in sorted(set(expected) | set(actual)):
        if rel not in expected:
            problems.append(f"  {label}: extra generated file {rel}")
        elif rel not in actual:
            problems.append(f"  {label}: missing generated file {rel}")
        elif not filecmp.cmp(expected[rel], actual[rel], shallow=False):
            problems.append(f"  {label}: content differs {rel}")
    return problems


def run(cmd: list[str], cwd: Path) -> None:
    exe = shutil.which(cmd[0])
    if exe is None:
        raise FileNotFoundError(f"{cmd[0]} not found on PATH")
    cmd = [exe, *cmd[1:]]
    print(f"  $ {' '.join(cmd)}  (cwd={cwd.relative_to(ROOT)})")
    subprocess.run(cmd, cwd=cwd, check=True)


def check_typescript(tmp: Path) -> list[str]:
    problems: list[str] = []
    for pkg in ("core", "fastify", "node", "hono", "next"):
        pkg_dir = ROOT / "typescript" / pkg
        fresh = tmp / f"ts-{pkg}"
        run(["npx", "typedoc", "--out", str(fresh)], pkg_dir)
        problems += diff_trees(f"typescript/{pkg}", pkg_dir / "apidocs", fresh)
    return problems


def check_python(tmp: Path) -> list[str]:
    py_dir = ROOT / "python"
    fresh = tmp / "py-apidocs"
    run(["sphinx-build", "-q", "-b", "html", "apidocs", str(fresh)], py_dir)
    # Sphinx emits non-deterministic artifacts: .doctrees pickles and
    # searchindex.js (embeds build ordering/timestamps).
    return diff_trees(
        "python",
        py_dir / "apidocs" / "_build" / "html",
        fresh,
        exclude={"searchindex.js"},
    )


def check_go(tmp: Path) -> list[str]:
    go_dir = ROOT / "go"
    fresh = tmp / "go-api"
    run(["go", "run", "./cmd/apidoc", "-out", str(fresh)], go_dir)
    # docs/api also contains a hand-written README.md — compare only the
    # files the generator emits (everything except README.md).
    return diff_trees(
        "go", go_dir / "docs" / "api", fresh, only={"core.md", "httpapi.md"}
    )


def main() -> int:
    problems: list[str] = []
    with tempfile.TemporaryDirectory(prefix="apipilot-docs-") as td:
        tmp = Path(td)
        for name, fn in (
            ("typescript", check_typescript),
            ("python", check_python),
            ("go", check_go),
        ):
            print(f"checking {name}…")
            try:
                problems += fn(tmp)
            except subprocess.CalledProcessError as e:
                problems.append(f"  {name}: generator failed ({e})")

    if problems:
        print("\nGenerated docs are STALE — regenerate and commit:")
        for p in problems:
            print(p)
        print("\nRegenerate with:")
        print("  typescript/*: npm run docs:api")
        print("  python:       make apidocs")
        print("  go:           make apidocs")
        return 1

    print("\nAll generated docs are fresh.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
