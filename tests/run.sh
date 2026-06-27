#!/usr/bin/env bash
# Dev-only test runner. NOT part of the deployed static site.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Static syntax checks =="
node --check assets/sdsg-app.js && echo "  sdsg-app.js OK"
node --check tools/kerry-import.js && echo "  kerry-import.js OK"
python3 -c "import ast,sys; ast.parse(open('tools/strong-import.py').read())" && echo "  strong-import.py OK"
python3 -c "import json; json.load(open('vercel.json'))" && echo "  vercel.json OK"

echo "== Program week files lint (3-set cap · slot-1 anchors · test slots · no movement dupes) =="
node tools/lint-week.js

echo "== .vercelignore guards Vercel from detecting a Node project =="
# F2: Without these entries Vercel would see package.json at the deploy root
# and run a Node build pipeline instead of serving the static files. Catch
# any accidental deletion before it ships.
for entry in package.json package-lock.json node_modules tests .github tools; do
  grep -qxF "$entry" .vercelignore || { echo "  MISSING from .vercelignore: $entry"; exit 1; }
done
echo "  .vercelignore complete"

echo "== Importer regression tests =="
python3 tests/importer.test.py

echo "== Playwright integration tests =="
# Resolve the playwright library from the global install if not in node_modules.
if [ -d node_modules/playwright ]; then
  node --test tests/app.test.js
else
  NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}" node --test tests/app.test.js
fi
