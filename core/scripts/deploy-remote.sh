#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_ROOT:?DEPLOY_ROOT is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
SSH_CMD="ssh -p ${DEPLOY_PORT}"

echo "==> Deploying to ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_ROOT}"

# Make sure target folders exist.
${SSH_CMD} "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "mkdir -p '${DEPLOY_ROOT}/core/storage' '${DEPLOY_ROOT}/public_html'"

# Private application code.
# Keep server-specific .env, persistent storage, and node_modules untouched.
rsync -az --delete \
  --exclude='.env' \
  --exclude='storage/' \
  --exclude='node_modules/' \
  -e "${SSH_CMD}" \
  core/ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_ROOT}/core/"

# Public web files.
# Preserve hosting-provider directories that may be managed outside this repository.
rsync -az --delete \
  --exclude='.well-known/' \
  --exclude='cgi-bin/' \
  --exclude='stats/' \
  -e "${SSH_CMD}" \
  public_html/ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_ROOT}/public_html/"

# Recreate runtime folders and tighten permissions.
${SSH_CMD} "${DEPLOY_USER}@${DEPLOY_HOST}" "
  mkdir -p \
    '${DEPLOY_ROOT}/core/storage/logs' \
    '${DEPLOY_ROOT}/core/storage/jobs' \
    '${DEPLOY_ROOT}/core/storage/otp' \
    '${DEPLOY_ROOT}/core/storage/rate' &&
  chmod 700 '${DEPLOY_ROOT}/core/storage' &&
  find '${DEPLOY_ROOT}/core/storage' -type d -exec chmod 700 {} \; &&
  if [ -f '${DEPLOY_ROOT}/core/.env' ]; then chmod 600 '${DEPLOY_ROOT}/core/.env'; fi
"

echo "==> Deployment completed"
