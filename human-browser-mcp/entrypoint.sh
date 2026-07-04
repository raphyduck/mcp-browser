#!/bin/sh
set -e
# Xvfb en arriere-plan : permet a Chromium de tourner en mode 'headed' (headless=false)
# dans le conteneur, ce qui reduit fortement la detection anti-bot (Cloudflare, etc.)
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp &
export DISPLAY=:99
# Attendre que le display soit pret
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ $i -lt 25 ]; do
  i=$((i+1)); sleep 0.2
done
exec node dist/index.js
