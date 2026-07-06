FROM ghcr.io/home-assistant/base:latest

ARG BUILD_ARCH
ARG BUILD_VERSION

LABEL \
  io.hass.name="Reactive Wire" \
  io.hass.description="Typed reactive automations for Home Assistant" \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="addon" \
  io.hass.version="${BUILD_VERSION}"

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY app/server ./server
COPY app/frontend ./frontend
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
