# ApiPilot Python port — build, test, and doc generation.
#
# Targets:
#   test         run unit + integration tests
#   lint         ruff check
#   conformance  run the 251-vector conformance suite
#   docs         regenerate docs/api-reference.md from the public API
#   apidocs      build Sphinx HTML API docs into apidocs/_build/html
#   all          test + lint + conformance

PYTHON ?= python

.PHONY: test lint conformance docs apidocs all

test:
	$(PYTHON) -m pytest tests/ -q

lint:
	ruff check src tests

conformance:
	$(PYTHON) tests/conformance_runner.py

docs:
	$(PYTHON) scripts/gen_api_docs.py > docs/api-reference.md

apidocs:
	sphinx-build -b html apidocs apidocs/_build/html

all: test lint conformance
