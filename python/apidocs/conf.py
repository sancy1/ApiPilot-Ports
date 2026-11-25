"""Sphinx configuration for the ApiPilot Python API reference.

Generates HTML API docs from docstrings via sphinx.ext.autodoc.
The docstrings are the single source of truth; this site is a build
artifact (``make apidocs``).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
)

project = "ApiPilot (Python)"
copyright = "2026, ApiPilot contributors"
author = "ApiPilot contributors"
release = "0.1.0"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "alabaster"

autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "undoc-members": True,
    "show-inheritance": True,
}

napoleon_google_docstring = True
napoleon_numpy_docstring = True
