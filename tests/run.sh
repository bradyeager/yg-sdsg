#!/usr/bin/env bash
# Dev-only test runner. NOT part of the deployed static site.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Static syntax checks =="
node --check assets/sdsg-app.js && echo "  sdsg-app.js OK"
node --check tools/kerry-import.js && echo "  kerry-import.js OK"
python3 -c "import ast,sys; ast.parse(open('tools/strong-import.py').read())" && echo "  strong-import.py OK"
python3 -c "import json; json.load(open('vercel.json'))" && echo "  vercel.json OK"

echo "== Importer regression tests =="
python3 tests/importer.test.py

echo "== Playwright integration tests =="
# Resolve the playwright library from the global install if not in node_modules.
if [ -d node_modules/playwright ]; then
  node --test tests/app.test.js
else
  NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}" node --test tests/app.test.js
fi
