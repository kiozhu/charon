#!/bin/bash
cd /home/ubuntu/charon2
exec node index.js >> logs/restart_clean.log 2>&1
