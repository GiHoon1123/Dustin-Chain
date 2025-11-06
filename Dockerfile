# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# 패키지 파일만 먼저 복사 (캐시 활용)
COPY package*.json ./

# 프로덕션 의존성 설치 (전체 설치 후 devDep 제거)
RUN npm ci && \
    npm prune --production && \
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

# TypeScript 빌드 (scripts도 함께 빌드됨)
RUN npm run build

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

# 빌드된 파일 복사 (dist/scripts 포함)
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# 패키지 파일 복사
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./

# Entrypoint 스크립트 복사
COPY --chown=nestjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 데이터 디렉토리 생성 (LevelDB 저장소)
# contract-bytecodes.json은 볼륨 마운팅으로 제공 (호스트에서 마운팅 필요)
RUN mkdir -p /app/data/chaindata && \
    mkdir -p /app/data/state

# /app 디렉토리 전체 권한 부여 (genesis 파일 생성 위해)
RUN chown -R nestjs:nodejs /app

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

# Entrypoint 실행 (genesis 파일 체크 후 앱 시작)
CMD ["sh", "./entrypoint.sh"]

