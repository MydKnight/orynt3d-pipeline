# docker/Dockerfile -- runs the orynt3d-pipeline on the QNAP, NAS-local (no VPN).
# x86_64. See docs/nas-container-spec.md.
#
# Build context is this `docker/` directory -- self-contained, so the whole repo
# does NOT need to be on the QNAP (the container clones the code at runtime):
#   docker compose -f compose.nas.yml run --rm pipeline
#
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

# The entrypoint clones the repo into /repo (a volume) and runs `npm ci` there.
COPY pipeline-run.sh /usr/local/bin/pipeline-run
COPY lib/git-sync.sh /usr/local/bin/lib/git-sync.sh
RUN chmod +x /usr/local/bin/pipeline-run

WORKDIR /repo
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pipeline-run"]
