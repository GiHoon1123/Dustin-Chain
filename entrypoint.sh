#!/bin/sh
set -e

echo "🚀 Starting Dustin-Chain..."

# Genesis 파일 생성 (없을 경우만)
# 빌드된 JS 파일 사용 (ts-node 불필요)
if [ ! -f "/app/genesis-accounts.json" ]; then
  echo "📝 Generating genesis-accounts.json..."
  node dist/scripts/generate-genesis-accounts.js
else
  echo "✅ genesis-accounts.json already exists"
fi

if [ ! -f "/app/genesis.json" ]; then
  echo "📝 Generating genesis.json..."
  node dist/scripts/generate-genesis.js
else
  echo "✅ genesis.json already exists"
fi

echo "✅ Genesis files ready"

# 애플리케이션 시작
exec node dist/main.js

