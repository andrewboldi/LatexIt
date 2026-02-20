#!/usr/bin/env bash
set -euo pipefail

OUT_FILE="${1:-tblatex.xpi}"
ADDON_ID="${2:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tblatex-build.XXXXXX")"

cleanup() {
  rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

mkdir -p "${BUILD_DIR}"

cp "${ROOT_DIR}/manifest.json" "${BUILD_DIR}/manifest.json"
cp "${ROOT_DIR}/icon.png" "${BUILD_DIR}/icon.png"
cp "${ROOT_DIR}/background.js" "${BUILD_DIR}/background.js"
cp "${ROOT_DIR}/README.md" "${BUILD_DIR}/README.md"
cp "${ROOT_DIR}/Changelog" "${BUILD_DIR}/Changelog"
cp -R "${ROOT_DIR}/api" "${BUILD_DIR}/api"
cp -R "${ROOT_DIR}/compose" "${BUILD_DIR}/compose"
cp -R "${ROOT_DIR}/ui" "${BUILD_DIR}/ui"

if [[ -n "${ADDON_ID}" ]]; then
  node - "${BUILD_DIR}/manifest.json" "${ADDON_ID}" <<'NODE'
const fs = require("fs");

const manifestPath = process.argv[2];
const addonId = process.argv[3];

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!manifest.applications || !manifest.applications.gecko) {
  throw new Error("manifest.applications.gecko is missing");
}

manifest.applications.gecko.id = addonId;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
fi

rm -f "${ROOT_DIR}/${OUT_FILE}"
(
  cd "${BUILD_DIR}"
  zip -r "${ROOT_DIR}/${OUT_FILE}" \
    manifest.json \
    icon.png \
    background.js \
    api \
    compose \
    ui \
    README.md \
    Changelog
)

echo "Built ${OUT_FILE}"
if [[ -n "${ADDON_ID}" ]]; then
  echo "Using add-on ID: ${ADDON_ID}"
fi
