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
      python3 \
      python3-venv \
 && rm -rf /var/lib/apt/lists/*

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
RUN set -eux; \
    git --version; \
    curl --version | head -n1; \
    node --version; \
    npm --version; \
    jq --version; \
    gh --version; \
    gh --version | awk 'NR==1 { split($3, v, "."); exit (v[1] * 10000 + v[2] * 100 + v[3] >= 24000) ? 0 : 1 }'; \
    python3 -c "import numpy, tqdm; print('numpy', numpy.__version__, 'tqdm', tqdm.__version__)"; \
    npx playwright --version
