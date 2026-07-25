# CI image: every tool our jobs need, already installed.
#
# The rule this exists to serve: CI jobs must not install tooling at run time.
# A job pulls this image and runs; nothing is fetched from a package index
# while a test is waiting on it.
#
# The authoritative pin is the DIGEST of this image, recorded in
# .automation.conf's CI_IMAGE and in the workflows that consume it. Everything
# below describes how the image is produced; once built, the digest freezes the
# exact bytes — including versions apt resolved at build time.
#
# Base is pinned by digest too, not just tag: upstream re-pushes version tags
# for CVE rebuilds, so `:v1.61.1-noble` alone is not immutable.
# The tag MUST match the playwright version in package.json (browsers baked
# into this image have to match the client that drives them, or playwright
# re-downloads ~300 MB at run time and silently defeats the whole point).
FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV DEBIAN_FRONTEND=noninteractive

# gh: required by scripts/automation/lib.sh's require_gh (>= 2.40, asserted
# below). jq: used by the workflows' structured-output parsing. python3-venv:
# noble's system Python is externally managed (PEP 668), so the solver's deps
# go in a venv rather than fighting pip's --break-system-packages.
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      gh \
      jq \
      git \
      curl \
      ca-certificates \
      unzip \
      python3 \
      python3-venv \
 && rm -rf /var/lib/apt/lists/*

# unzip is not optional: claude-code-action bootstraps its runtime through
# oven-sh/setup-bun, which downloads bun-linux-x64.zip and shells out to
# unzip. ubuntu-latest runners ship it, so its absence only surfaces once a
# job moves into a container (run 30161240812: "Unable to locate executable
# file: unzip" -> "bun: command not found" -> exit 127).

# The workspace is bind-mounted from the runner and owned by a different uid
# than this image's root, so git refuses to touch it ("detected dubious
# ownership") — which breaks not just git but `gh`, since gh shells out to
# git. That took out the implement job's label bookkeeping and would have
# taken out its commit/push too (same run). Every consumer of this image hits
# it, so it is fixed once here rather than per workflow.
RUN git config --system --add safe.directory '*'

# Solver dependencies, exact versions. Bump = edit here, rebuild, repin.
ARG NUMPY_VERSION=2.5.1
ARG TQDM_VERSION=4.69.1
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV" \
 && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir --upgrade pip \
 && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir \
      "numpy==${NUMPY_VERSION}" \
      "tqdm==${TQDM_VERSION}"
ENV PATH="/opt/venv/bin:$PATH"

# Fail the BUILD, not a run, if any expected tool is missing or too old.
# git especially: without it actions/checkout silently falls back to a REST
# tarball that ignores sparse-checkout/filter — which here means dragging in
# the 2.5 GiB math/data pack and leaving no .git for release.sh to work with.
# Capture into a variable before trimming: `cmd --version | head -n1` gives the
# writer SIGPIPE once head exits, which under `pipefail` + `set -e` fails the
# build with 141 for a tool that is present and fine (it did — unzip's banner
# is long enough to still be writing). Assert presence separately from
# printing versions.
RUN set -eux; \
    for tool in git curl node npm jq unzip gh python3; do \
      command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 1; }; \
    done; \
    versions="$(git --version; curl --version; node --version; npm --version; jq --version; unzip -v; gh --version)"; \
    printf '%s\n' "$versions" | grep -E '^(git|curl|jq|gh|UnZip|v[0-9])' || true; \
    git config --system --get-all safe.directory; \
    gh_version="$(gh --version)"; \
    printf '%s\n' "$gh_version" | awk 'NR==1 { split($3, v, "."); exit (v[1] * 10000 + v[2] * 100 + v[3] >= 24000) ? 0 : 1 }'; \
    python3 -c "import numpy, tqdm; print('numpy', numpy.__version__, 'tqdm', tqdm.__version__)"; \
    ls -1 "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}" | head -n5; \
    test -n "$(ls -A "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}" 2>/dev/null)"
