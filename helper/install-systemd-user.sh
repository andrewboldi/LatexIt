#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="tblatex-helper.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SCRIPT="${SCRIPT_DIR}/tblatex_helper.py"

XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_DIR="${XDG_DATA_HOME}/tblatex-helper"
CONFIG_DIR="${XDG_CONFIG_HOME}/tblatex-helper"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME}/systemd/user"
TARGET_SCRIPT="${INSTALL_DIR}/tblatex_helper.py"
ENV_FILE="${CONFIG_DIR}/env"
UNIT_FILE="${SYSTEMD_USER_DIR}/${SERVICE_NAME}"

if [[ ! -f "${SOURCE_SCRIPT}" ]]; then
  echo "Missing helper source script: ${SOURCE_SCRIPT}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not installed." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. Cannot install systemd user service." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}" "${CONFIG_DIR}" "${SYSTEMD_USER_DIR}"
cp "${SOURCE_SCRIPT}" "${TARGET_SCRIPT}"
chmod 0755 "${TARGET_SCRIPT}"

if [[ ! -f "${ENV_FILE}" ]]; then
  cat >"${ENV_FILE}" <<'EOF'
TBLATEX_HELPER_HOST=127.0.0.1
TBLATEX_HELPER_PORT=3737
EOF
  chmod 0644 "${ENV_FILE}"
fi

cat >"${UNIT_FILE}" <<EOF
[Unit]
Description=LaTeX It local helper service
After=network.target

[Service]
Type=simple
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env python3 ${TARGET_SCRIPT}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

if ! systemctl --user daemon-reload; then
  echo "Failed to reload user systemd daemon." >&2
  exit 1
fi

if ! systemctl --user enable --now "${SERVICE_NAME}"; then
  echo "Failed to enable/start ${SERVICE_NAME}. Try: systemctl --user status ${SERVICE_NAME}" >&2
  exit 1
fi

echo "Installed and started ${SERVICE_NAME}."
echo "Helper config: ${ENV_FILE}"
echo "Service file: ${UNIT_FILE}"
echo "Status: systemctl --user status ${SERVICE_NAME}"
