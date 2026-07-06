FROM ghcr.io/prefix-dev/pixi:0.71.0

ARG BUILD_VERSION=0.0.0-dev

LABEL \
  io.hass.name="Reactive Wire" \
  io.hass.description="Typed reactive automations for Home Assistant" \
  io.hass.arch="aarch64|amd64" \
  io.hass.type="addon" \
  io.hass.version="${BUILD_VERSION}"

ENV PIXI_NO_PROGRESS=true

WORKDIR /app
COPY app/pixi.toml app/pixi.lock ./
RUN pixi install --locked -e runtime

COPY app/package*.json ./
RUN pixi run --locked -e runtime npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
  && pixi run --locked -e runtime npm cache clean --force

COPY app/server ./server
COPY app/frontend ./frontend
COPY run.sh /run.sh
RUN pixi shell-hook -e runtime -s bash > /app/pixi-env.sh \
  && printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'source /app/pixi-env.sh' 'exec "$@"' > /entrypoint.sh \
  && chmod a+x /entrypoint.sh /run.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/run.sh"]
