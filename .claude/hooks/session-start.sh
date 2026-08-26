#!/bin/bash
#
# Install this project's dependencies so a fresh session can run the tests and the dev
# server without ceremony.
#
# A remote container clones the repository and nothing else, so `node_modules/` is absent
# and every first command in a session — `npm test`, `npm run build`, `npm run map` —
# fails on a missing dependency until somebody installs. That is a minute of every session
# spent on the same thing.
#
# Local checkouts are left alone: a developer's `node_modules/` is their business, and a
# hook that runs `npm install` on every session there would fight whatever they have
# installed by hand.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `install`, not `ci`: the container image is cached after this runs, and `ci` deletes
# `node_modules/` first, which throws that cache away on every session.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "[session-start] installing dependencies"
  npm install --no-audit --no-fund
else
  echo "[session-start] dependencies already present"
fi
