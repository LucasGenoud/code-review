#!/bin/sh
# Bind-mounted data dirs are created root-owned by Docker. Hand /data to
# the unprivileged `node` user, then drop root before starting the app.
set -e

chown node:node "$DATA_DIR"

# Sandbox job folder: app-only (700). Code run by the sandbox as `nobody`
# can't read or forge jobs; the runner gets in via DAC_OVERRIDE.
if [ -n "$SANDBOX_DIR" ]; then
  mkdir -p "$SANDBOX_DIR"
  chown node:node "$SANDBOX_DIR"
  chmod 700 "$SANDBOX_DIR"
fi

exec setpriv --reuid=node --regid=node --init-groups "$@"
