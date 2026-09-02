#!/usr/bin/env bash
# docker/pipeline-run.sh -- container entrypoint. Runs the orynt3d-pipeline
# NAS-local (no VPN), then commits + pushes data/pipeline.db.
# See docs/nas-container-spec.md.
set -euo pipefail

CMD="${1:-pipeline}"   # pipeline | download | sync
case "$CMD" in
  pipeline|download|sync) ;;
  *) echo "usage: run --rm pipeline [pipeline|download|sync]"; exit 2 ;;
esac

: "${NAS_3D_FILES_PATH:?set NAS_3D_FILES_PATH (the mounted 3D Files path, e.g. /nas/3D Files)}"
export NAS_3D_FILES_PATH
export STAGING_PATH="${STAGING_PATH:-/work/staging}"
export TMPDIR="${TMPDIR:-/work/tmp}"
mkdir -p "$STAGING_PATH" "$TMPDIR"

BRANCH="${TARGET_BRANCH:-master}"
if [ -n "${GH_REMOTE:-}" ]; then
  REMOTE="$GH_REMOTE"
else
  : "${GH_REPO:?set GH_REPO, e.g. MydKnight/orynt3d-pipeline}"
  : "${GH_TOKEN:?set GH_TOKEN (fine-grained PAT, contents:write on GH_REPO)}"
  REMOTE="https://x-access-token:${GH_TOKEN}@github.com/${GH_REPO}.git"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/git-sync.sh
source "${SCRIPT_DIR}/lib/git-sync.sh"

cd /repo
git_setup "$REMOTE" "$BRANCH"
echo "-> sync to origin/${BRANCH}"
git_sync "$BRANCH"

echo "-> npm ci"
npm ci --no-audit --no-fund

echo "-> npm run ${CMD}"
set +e
npm run "$CMD"
rc=$?
set -e

if [ "$CMD" != "sync" ]; then
  # Never let a tracker-DB push failure mask the pipeline's own exit code or
  # abort the script (set -e) -- the NAS write has already happened.
  git_commit_db "$BRANCH" "chore(tracker): ${CMD} $(date -u +%Y-%m-%dT%H:%MZ)" \
    || echo "WARNING: tracker DB not pushed this run -- 'npm run download' backfill may be needed" >&2
fi

exit "$rc"
