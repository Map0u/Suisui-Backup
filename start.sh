#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "========================================================"
echo "  岁岁 · 时光纪念馆 正在启动本地服务..."
echo "  请在浏览器打开：http://127.0.0.1:3566"
echo "========================================================"
export HOST=127.0.0.1
export PORT=3566
if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "http://127.0.0.1:3566") &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 1 && xdg-open "http://127.0.0.1:3566") &
fi
exec node server/index.js
