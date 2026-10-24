#!/bin/bash
# Start the expense tracker. Ctrl-C to stop.
cd "$(dirname "$0")"
exec node --no-warnings src/server.js
