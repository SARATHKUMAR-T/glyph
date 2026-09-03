#!/bin/sh
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  # Remove from /etc/skel
  rm -f "/etc/skel/.local/share/nautilus/scripts/Open in Glyph" 2>/dev/null || true

  # Remove from user homes
  for user_home in /home/*; do
    if [ -d "$user_home" ]; then
      rm -f "$user_home/.local/share/nautilus/scripts/Open in Glyph" 2>/dev/null || true
    fi
  done

  # Remove x-terminal-emulator alternative
  if command -v update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove x-terminal-emulator /usr/bin/glyph 2>/dev/null || true
  fi

  # Update desktop database
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
  fi
fi

exit 0

