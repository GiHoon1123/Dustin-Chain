# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# 패키지 파일만 먼저 복사 (캐시 활용)
COPY package*.json ./

# 프로덕션 의존성만 설치
RUN npm ci --only=production && \
    npm cache clean --force

# ==========================================
# Stage 2: Builder
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./

# 모든 의존성 설치 (devDependencies 포함)
RUN npm ci

# 소스 코드 복사
COPY . .

# TypeScript 빌드
RUN npm run build

# Genesis 파일 생성 (없을 경우)
RUN if [ ! -f "genesis-accounts.json" ]; then \
      echo "📝 Generating genesis-accounts.json..." && \
      npm run generate:accounts; \
    fi && \
    if [ ! -f "genesis.json" ]; then \
      echo "📝 Generating genesis.json..." && \
      npm run generate:genesis; \
    fi

# ==========================================
# Stage 3: Runner (Production)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# 보안: non-root 유저 생성
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# 프로덕션 의존성 복사
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules

# 빌드된 파일 복사
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Genesis 파일들 복사 (블록체인 초기화에 필요)
COPY --from=builder --chown=nestjs:nodejs /app/genesis.json ./genesis.json
COPY --from=builder --chown=nestjs:nodejs /app/genesis-accounts.json ./genesis-accounts.json

# 패키지 파일 복사
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./

# 데이터 디렉토리 생성 (LevelDB 저장소)
RUN mkdir -p /app/data/chaindata && \
    mkdir -p /app/data/state && \
    chown -R nestjs:nodejs /app/data

# non-root 유저로 전환
USER nestjs

# 포트 노출
EXPOSE 3000

# 환경 변수 기본값
ENV NODE_ENV=production \
    PORT=3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 실행
CMD ["node", "dist/main.js"]

