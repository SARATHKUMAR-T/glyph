#!/bin/sh
set -e

# 1. Install Nautilus context menu script for all users
SCRIPT_SRC="/usr/share/glyph/scripts/Open in Glyph"

if [ -f "$SCRIPT_SRC" ]; then
  # For future newly created users
  mkdir -p /etc/skel/.local/share/nautilus/scripts
  cp "$SCRIPT_SRC" "/etc/skel/.local/share/nautilus/scripts/Open in Glyph"
  chmod 755 "/etc/skel/.local/share/nautilus/scripts/Open in Glyph"

  # For all existing users in /home
  for user_home in /home/*; do
    if [ -d "$user_home" ]; then
      user_scripts="$user_home/.local/share/nautilus/scripts"
      mkdir -p "$user_scripts"
      cp "$SCRIPT_SRC" "$user_scripts/Open in Glyph"
      chmod 755 "$user_scripts/Open in Glyph"
      user_name=$(basename "$user_home")
      chown -R "$user_name:$user_name" "$user_home/.local/share/nautilus" 2>/dev/null || true
    fi
  done
fi

# 2. Register Glyph as an alternative for x-terminal-emulator
if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --install /usr/bin/x-terminal-emulator x-terminal-emulator /usr/bin/glyph 45 || true
fi

# 3. Update desktop and MIME databases
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi

exit 0

