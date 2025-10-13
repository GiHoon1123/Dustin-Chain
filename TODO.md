# Dustin-Chain 개발 TODO List

> 이더리움 POS 기반 블록체인 - 핵심 기능 MVP

---

## 🎯 목표

서버에 배포 가능한 최소 기능 블록체인 구현

---

## Phase 1: 기초 인프라 🔧

### 1.1 Crypto 유틸리티

- [x] SHA-256 해시 함수 구현 (불필요 - Keccak-256만 사용)
- [x] Keccak-256 해시 함수 구현 (이더리움 표준)
  - hashBuffer, hashHex, hashUtf8 분리
- [x] secp256k1 키 생성 (개인키 → 공개키)
- [x] ECDSA 서명 & 검증
  - EIP-155 지원 (chainId 포함)
- [x] 이더리움 스타일 주소 생성 (0x...)
- [x] 유틸리티 테스트 작성

### 1.2 기본 타입 정의

- [x] Address 타입
- [x] Hash 타입
- [x] Signature 타입 (v, r, s)
- [x] BigNumber 처리 (큰 숫자) - BigInt 사용
- [x] Constants 정의 (BLOCK_TIME, MIN_STAKE, REWARD 등)

---

## Phase 2: 핵심 데이터 구조 📦

### 2.1 Account 모듈

- [x] Account 엔티티 생성
  - address (주소)
  - balance (잔액)
  - nonce (트랜잭션 순서 번호)
  - stakedBalance (스테이킹 금액) - Phase 4로 이동
- [x] Account Service
  - 계정 생성 및 조회
  - 잔액 관리
  - Nonce 관리
  - 계정 간 송금
- [x] Account 상태 저장소 (In-Memory)
  - Repository Pattern 적용
  - IAccountRepository 인터페이스
  - InMemoryAccountRepository 구현
- [x] Account Controller
  - POST /account/create-wallet
  - GET /account/:address
  - GET /account/:address/balance
  - GET /account/:address/nonce
  - POST /account/add-balance (테스트용)
  - POST /account/transfer
- [x] Account Service 테스트 작성 (18개 테스트 통과)

### 2.2 Transaction 모듈

- [x] Transaction 엔티티
  - from, to, value, nonce
  - v, r, s (서명)
  - status (pending/confirmed/failed)
- [x] 트랜잭션 서명 (EIP-155)
- [x] 트랜잭션 검증 로직
  - 서명 검증 (ecrecover)
  - Nonce 검증
  - 잔액 검증
- [x] 트랜잭션 해시 계산
- [x] Transaction Pool (Mempool) 구현 (In-Memory)
- [x] Transaction Service
  - signTransaction (테스트용)
  - submitTransaction
  - validateTransaction
  - getTransaction
- [x] Transaction Controller
  - POST /transaction/sign (테스트용)
  - POST /transaction/send
  - GET /transaction/:hash
- [x] Swagger 문서화

### 2.3 Block 모듈

- [x] Block 엔티티
  - number, hash, parentHash
  - timestamp
  - proposer (임시 고정 주소)
  - transactions (전체 객체 저장)
  - stateRoot, transactionsRoot
- [x] Block Repository 인터페이스
- [x] InMemoryBlockRepository 구현
- [x] Block Service
  - Genesis Block 생성
  - 블록 생성 로직
  - 트랜잭션 실행
  - Proposer 보상 지급
  - 블록 해시 계산
  - 블록 조회
- [x] Block Producer (자동 생성)
  - Slot 기반 시스템 (Genesis 시간 기준)
  - 12초마다 자동 블록 생성
  - 서버 시작 시 자동 시작
  - Mempool에서 트랜잭션 선택 및 실행
- [x] Block Controller
  - GET /block/latest
  - GET /block/number/:number
  - GET /block/hash/:hash
  - GET /block/stats
  - GET /block/producer-status
- [x] Swagger 문서화
- [x] BlockModule 생성 및 통합

---

## Phase 3: 상태 관리 💾

### 3.1 State Manager

- [ ] 전역 상태 관리 (모든 계정)
- [ ] Genesis State 초기화
  - 창시자 계정: 10,000,000 DSTN
  - 테스트 계정 3개: 각 100,000 DSTN
- [ ] 상태 변경 메서드 (트랜잭션 실행)
- [ ] 상태 조회 메서드
- [ ] 간단한 Merkle Root 계산

### 3.2 Transaction Pool

- [ ] Pending 트랜잭션 저장
- [ ] Gas Price 기반 우선순위
- [ ] 트랜잭션 추가/제거
- [ ] 무효 트랜잭션 필터링

---

## Phase 4: POS 합의 메커니즘 ⚡

### 4.1 Validator 모듈

- [ ] Validator 엔티티
  - address
  - stakedAmount
  - isActive
  - rewards
- [ ] 밸리데이터 등록 (최소 32 DSTN)
- [ ] 밸리데이터 활성화/비활성화
- [ ] Validator Service

### 4.2 Staking 시스템

- [ ] 스테이킹 예치 로직
- [ ] 스테이킹 인출 로직
- [ ] 스테이킹 금액 검증
- [ ] Staking Service

### 4.3 Consensus Engine

- [ ] 슬롯/에포크 시스템 (12초/슬롯)
- [ ] 다음 블록 생성자 선택 알고리즘
  - 가중치 기반 무작위 선택
- [ ] 블록 검증 (proposer 권한 확인)
- [ ] 보상 분배 (2 DSTN + 수수료)
- [ ] Consensus Service

---

## Phase 5: 블록체인 통합 🔗

### 5.1 Blockchain Core

- [ ] Genesis Block 생성
- [ ] 블록 추가 로직
  - 블록 검증
  - 트랜잭션 실행
  - 상태 업데이트
  - 체인에 추가
- [ ] 블록 조회 (번호, 해시)
- [ ] 체인 상태 조회
- [ ] Blockchain Service

### 5.2 Block Production

- [ ] 12초마다 자동 블록 생성
- [ ] Mempool에서 트랜잭션 선택
- [ ] 블록 조립
- [ ] 블록 서명
- [ ] 블록 브로드캐스트 (로컬)
- [ ] Block Producer Service

---

## Phase 6: API 엔드포인트 🌐

### 6.1 Wallet Controller

- [ ] `POST /wallet/create` - 새 지갑 생성
- [ ] `POST /wallet/import` - 개인키로 지갑 가져오기
- [ ] `GET /wallet/:address` - 지갑 정보 조회

### 6.2 Account Controller

- [ ] `GET /account/:address` - 계정 잔액 조회
- [ ] `GET /account/:address/transactions` - 계정 트랜잭션 내역

### 6.3 Transaction Controller

- [ ] `POST /transaction/send` - 트랜잭션 전송
- [ ] `GET /transaction/:hash` - 트랜잭션 조회
- [ ] `GET /transaction/pool` - Mempool 조회
- [ ] `GET /transaction/pending/:address` - 특정 주소의 pending 트랜잭션

### 6.4 Staking Controller

- [ ] `POST /staking/deposit` - 스테이킹 예치
- [ ] `POST /staking/withdraw` - 스테이킹 인출
- [ ] `GET /staking/validators` - 밸리데이터 목록
- [ ] `GET /staking/:address` - 스테이킹 정보 조회

### 6.5 Block Controller

- [ ] `GET /block/latest` - 최신 블록 조회
- [ ] `GET /block/:number` - 블록 번호로 조회
- [ ] `GET /block/hash/:hash` - 블록 해시로 조회

### 6.6 Blockchain Controller

- [ ] `GET /blockchain/status` - 체인 상태 (높이, 밸리데이터 수 등)
- [ ] `GET /blockchain/genesis` - Genesis 블록 조회

---

## Phase 7: 배포 준비 🚀

### 7.1 설정 & 환경

- [ ] 환경 변수 설정 (.env)
- [ ] 설정 파일 (config.ts)
- [ ] 로깅 시스템 (winston)
- [ ] 에러 핸들링

### 7.2 문서화

- [ ] README 업데이트
  - 프로젝트 소개
  - 설치 방법
  - API 문서
  - 사용 예시
- [ ] API 문서 (Swagger)
- [ ] 아키텍처 다이어그램

### 7.3 테스트

- [ ] 핵심 기능 단위 테스트
- [ ] E2E 테스트
- [ ] 트랜잭션 시나리오 테스트
- [ ] 스테이킹 시나리오 테스트

### 7.4 서버 배포

- [ ] Docker 설정
- [ ] 프로덕션 빌드
- [ ] PM2 설정 (프로세스 관리)
- [ ] 서버 배포

---

## 🎁 추가 기능 (나중에)

### 선택적 기능

- [ ] 트랜잭션 수수료 (Gas) 시스템
- [ ] EIP-1559 스타일 Base Fee
- [ ] 슬래싱 (악의적 행동 처벌)
- [ ] 인출 대기 큐
- [ ] Block Explorer (웹 UI)
- [ ] 지갑 웹 인터페이스

### Phase 2 (미래)

- [ ] P2P 네트워크 (실제 분산 네트워크)
- [ ] EVM 구현 (스마트 컨트랙트)
- [ ] ERC-20 토큰 지원
- [ ] 데이터베이스 영속성 (PostgreSQL)

---

## 📊 진행 상황

- [ ] Phase 1: 기초 인프라 (0%)
- [ ] Phase 2: 핵심 데이터 구조 (0%)
- [ ] Phase 3: 상태 관리 (0%)
- [ ] Phase 4: POS 합의 (0%)
- [ ] Phase 5: 블록체인 통합 (0%)
- [ ] Phase 6: API 엔드포인트 (0%)
- [ ] Phase 7: 배포 준비 (0%)

---

## 🎯 MVP 핵심 목표

**최소 기능으로 동작하는 블록체인:**

1. ✅ 지갑 생성 가능
2. ✅ 코인 전송 가능
3. ✅ 스테이킹 가능
4. ✅ 자동으로 블록 생성
5. ✅ REST API로 조회 가능

**이것만 되면 배포 가능!** 🚀
