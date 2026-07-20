#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
USER_DATA_BASE="${XDG_DATA_HOME:-${HOME}/.local/share}"
USER_CONFIG_BASE="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_DIRECTORY="${ARCHIVHAFEN_INSTALL_DIR:-${USER_DATA_BASE}/archivhafen-app}"
SYSTEMD_DIRECTORY="${USER_CONFIG_BASE}/systemd/user"
ARCHIVHAFEN_CONFIG_DIRECTORY="${USER_CONFIG_BASE}/archivhafen"
LEGACY_CONFIG_DIRECTORY="${USER_CONFIG_BASE}/mailstore"
APPLICATION_DIRECTORY="${USER_DATA_BASE}/applications"

cd "${PROJECT_DIRECTORY}"
npm install
npm run build

mkdir -p "${INSTALL_DIRECTORY}" "${SYSTEMD_DIRECTORY}" "${ARCHIVHAFEN_CONFIG_DIRECTORY}" "${APPLICATION_DIRECTORY}"
cp -a dist package.json package-lock.json public "${INSTALL_DIRECTORY}/"

cd "${INSTALL_DIRECTORY}"
npm ci --omit=dev

NODE_BINARY="$(command -v node)"
if [[ ! -f "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment" && -f "${LEGACY_CONFIG_DIRECTORY}/environment" ]]; then
  cp "${LEGACY_CONFIG_DIRECTORY}/environment" "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment"
  sed -i 's/MAILSTORE_/ARCHIVHAFEN_/g' "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment"
fi

if [[ ! -f "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment" ]]; then
  cat > "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment" <<EOF
ARCHIVHAFEN_HOST=127.0.0.1
ARCHIVHAFEN_PORT=4174
ARCHIVHAFEN_SYNC_INTERVAL_MINUTES=15
EOF
fi
chmod 600 "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment"

cat > "${SYSTEMD_DIRECTORY}/archivhafen.service" <<EOF
[Unit]
Description=Archiv Hafen – lokales E-Mail-Archiv
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIRECTORY}
ExecStart="${NODE_BINARY}" "${INSTALL_DIRECTORY}/dist/server/index.js"
Environment=NODE_ENV=production
EnvironmentFile=-${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "${APPLICATION_DIRECTORY}/archivhafen.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Archiv Hafen
Comment=Lokales E-Mail-Archiv öffnen
Icon=${INSTALL_DIRECTORY}/public/icon.svg
Exec=xdg-open http://127.0.0.1:4174
Terminal=false
Categories=Office;Email;
StartupNotify=true
EOF

chmod 600 "${SYSTEMD_DIRECTORY}/archivhafen.service"
chmod 644 "${APPLICATION_DIRECTORY}/archivhafen.desktop"
systemctl --user daemon-reload
systemctl --user disable --now mailstore.service >/dev/null 2>&1 || true
systemctl --user enable --now archivhafen.service

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPLICATION_DIRECTORY}" >/dev/null 2>&1 || true
fi

printf 'Archiv Hafen wurde installiert.\nÖffne http://127.0.0.1:4174 oder starte „Archiv Hafen“ aus dem Anwendungsmenü.\nKonfiguration: %s\n' "${ARCHIVHAFEN_CONFIG_DIRECTORY}/environment"
