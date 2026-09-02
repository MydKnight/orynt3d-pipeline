# docker/lib/git-sync.sh
# The git bits of the NAS pipeline container, split out so they can be tested
# without Docker or a network (see tests/docker/git-sync.test.ts).
# Sourced by docker/pipeline-run.sh. Assumes CWD is the repo checkout dir.

# Clone the repo into CWD if it's empty, otherwise just re-point the remote.
# $1 = remote URL, $2 = branch
git_setup() {
  local remote="$1" branch="$2"
  if [ ! -d .git ]; then
    echo "  cloning @ ${branch}"
    git clone --quiet --branch "$branch" "$remote" .
  else
    git remote set-url origin "$remote"
  fi
  git config user.name  "${GIT_NAME:-nas-pipeline-container}"
  git config user.email "${GIT_EMAIL:-nas-pipeline-container@users.noreply.github.com}"
  git config --global --add safe.directory "$(pwd)"
}

# Take origin/<branch> as the source of truth. The container never leaves
# uncommitted work (it commits pipeline.db at the end of every run), so a hard
# reset here is always safe and picks up code pushed from the laptop plus the
# previous run's pipeline.db commit.
# $1 = branch
git_sync() {
  local branch="$1"
  git fetch --quiet origin "$branch"
  # --force discards any local modifications to tracked files (e.g. from a run
  # killed mid-write); -B re-points the branch. This alone replaces a separate
  # `git reset --hard`.
  git checkout --quiet --force -B "$branch" "origin/${branch}"
}

# Commit + push data/pipeline.db if it changed. No-op (return 0) when the tracker
# DB is byte-identical to what's already on the branch. pipeline.db is cumulative
# state, so there's no rewind -- one commit per run, which doubles as a
# "when was each release processed" log.
#
# A run can take hours; the laptop may push code in the meantime, which makes the
# first `--force-with-lease` push stale-reject. Rebase the tracker commit onto the
# fresh origin tip and retry -- the commit only touches data/pipeline.db so it
# cannot conflict with laptop code changes. If it still fails, return non-zero so
# the caller can warn (but do not abort the run -- the NAS write already happened).
# $1 = branch, $2 = commit message
git_commit_db() {
  local branch="$1" msg="$2"
  git add data/pipeline.db
  if git diff --cached --quiet -- data/pipeline.db; then
    echo "  tracker DB unchanged -- nothing to commit"
    return 0
  fi
  git commit --quiet -m "$msg" -- data/pipeline.db

  local attempt
  for attempt in 1 2 3; do
    if git push --force-with-lease --quiet origin "$branch"; then
      echo "  pushed tracker DB snapshot"
      return 0
    fi
    echo "  push rejected -- rebasing tracker commit onto origin/${branch} (attempt ${attempt})"
    git fetch --quiet origin "$branch"
    if ! git rebase --quiet "origin/${branch}"; then
      git rebase --abort
      echo "  could not rebase tracker commit onto origin/${branch}" >&2
      return 1
    fi
  done
  echo "  tracker DB push failed after 3 attempts" >&2
  return 1
}
