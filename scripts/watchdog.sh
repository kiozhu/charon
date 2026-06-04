#!/bin/bash
STATUS=$(pm2 status charon2 --no-color 2>/dev/null | grep -c "online")
if [ "$STATUS" -eq 0 ]; then
  echo "BOT DOWN - restarting..."
  cd /home/ubuntu/charon2 && pm2 start npm --name "charon2" -- start 2>&1
  pm2 save 2>/dev/null
  echo "Restarted at $(date)"
else
  LAST=$(pm2 logs charon2 --nostream --lines 1 2>/dev/null | grep -oP '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' | tail -1)
  echo "OK - last activity: $LAST"
fi