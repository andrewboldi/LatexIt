#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="tblatex-helper.service"

XDG_DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_DIR="${XDG_DATA_HOME}/tblatex-helper"
CONFIG_DIR="${XDG_CONFIG_HOME}/tblatex-helper"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME}/systemd/user"
TARGET_SCRIPT="${INSTALL_DIR}/tblatex_helper.py"
ENV_FILE="${CONFIG_DIR}/env"
UNIT_FILE="${SYSTEMD_USER_DIR}/${SERVICE_NAME}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
fi

if [[ -f "${UNIT_FILE}" ]]; then
  rm -f "${UNIT_FILE}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user reset-failed >/dev/null 2>&1 || true
fi

rm -f "${TARGET_SCRIPT}"
rmdir "${INSTALL_DIR}" 2>/dev/null || true

if [[ "${1:-}" == "--purge-config" ]]; then
  rm -f "${ENV_FILE}"
  rmdir "${CONFIG_DIR}" 2>/dev/null || true
fi

echo "Uninstalled ${SERVICE_NAME}."
if [[ "${1:-}" != "--purge-config" ]]; then
  echo "Config kept at ${ENV_FILE} (remove with --purge-config)."
fi
