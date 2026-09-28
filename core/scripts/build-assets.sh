#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$CORE_DIR"

echo "==> Core directory: $CORE_DIR"
echo "==> Node: $(node --version)"
echo "==> NPM:  $(npm --version)"
echo "==> PHP:  $(php -r 'echo PHP_VERSION;')"

if [[ -f package-lock.json ]]; then
  echo "==> Installing Node dependencies with npm ci"
  npm ci --no-audit --no-fund
else
  echo "==> Installing Node dependencies with npm install"
  npm install --no-audit --no-fund
fi

echo "==> Building Tailwind CSS"
npm run build:css

echo "==> Linting PHP files"
while IFS= read -r -d '' file; do
  php -l "$file" >/dev/null
  echo "OK  $file"
done < <(find app ../public_html -type f -name '*.php' -print0)

echo "==> Build completed successfully"
