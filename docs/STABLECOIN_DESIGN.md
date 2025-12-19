# 담보형 스테이블 코인 시스템 설계

## 개요

DSTN을 담보로 하여 스테이블 코인을 발행하는 시스템을 구현합니다.

**핵심 가정:**

- 1 DSTN = 1,000 USD (고정 환율)
- 담보비율: 150% (1.5배)
- 스테이블 코인: USDST (USD Stable Token)

**기술 스택:**

- **Solidity**: 컨트랙트 작성 언어 (이더리움 표준)
- **EVM**: Ethereum Virtual Machine에서 실행 (EthereumJS VM 사용)
- **ERC20**: 스테이블 코인 토큰 표준 준수
- **이더리움 호환**: 이더리움 메인넷과 동일한 작동 방식

---

## 1. 시스템 아키텍처

### 1.1 컨트랙트 구조

```
┌─────────────────┐
│  StableCoin.sol │  ERC20 기반 스테이블 코인 토큰
│  (USDST)        │  - mint/burn 권한: Vault만 가능
└────────┬────────┘
         │
         │ mint/burn 호출
         │
┌────────▼────────┐
│CollateralVault  │  핵심 비즈니스 로직
│     .sol        │  - 담보 관리
│                 │  - 발행/상환
│                 │  - 청산
└─────────────────┘
```

### 1.2 컨트랙트 상세

#### **StableCoin.sol** (ERC20 기반)

- **언어**: Solidity (이더리움 표준)
- **표준**: ERC20 완전 준수
- **역할**: 스테이블 코인 토큰 발행 및 관리
- **주요 기능**:
  - `mint(address to, uint256 amount)`: 발행 (Vault만 호출 가능)
  - `burn(address from, uint256 amount)`: 소각 (Vault만 호출 가능)
  - 표준 ERC20 기능 (transfer, balanceOf, approve, allowance 등)
- **권한 관리**: `onlyVault` 모디파이어로 Vault만 mint/burn 가능
- **메서드 가시성**: ERC20 표준 메서드는 모두 `public`
- **실행 환경**: EVM (EthereumJS VM)

#### **CollateralVault.sol** (핵심 컨트랙트)

- **언어**: Solidity (이더리움 표준)
- **역할**: 담보 관리 및 스테이블 코인 발행/상환
- **메서드 가시성**: 모든 메서드는 `public` (누구나 호출 가능)
- **주요 기능**:
  - `depositCollateral()`: DSTN 담보 예치 (public)
  - `mintStablecoin(uint256 stablecoinAmount)`: 스테이블 코인 발행 (public)
  - `redeemStablecoin(uint256 stablecoinAmount)`: 스테이블 코인 상환 (public)
  - `withdrawCollateral(uint256 amount)`: 담보 인출 (public)
  - `liquidate(address user)`: 청산 실행 (public, 누구나 실행 가능)
- **상태 변수**:
  ```solidity
  mapping(address => uint256) public collateral;      // 사용자별 담보 잔액
  mapping(address => uint256) public stablecoinDebt;   // 사용자별 발행한 스테이블 코인
  uint256 constant DSTN_PRICE = 1000;                  // 1 DSTN = 1000 USD
  uint256 constant COLLATERAL_RATIO = 150;             // 150% (1.5배)
  ```
- **실행 환경**: EVM (EthereumJS VM)

---

## 2. 비즈니스 로직

### 2.1 담보 예치 (Deposit)

```
사용자가 DSTN을 Vault에 예치
→ collateral[user] += amount
```

**요구사항:**

- 사용자가 충분한 DSTN 잔액 보유
- Vault가 사용자로부터 DSTN 전송 받음

### 2.2 스테이블 코인 발행 (Mint)

```
요구사항:
collateral[user] * DSTN_PRICE >= stablecoinAmount * COLLATERAL_RATIO / 100

실행:
1. 담보비율 검증
2. stablecoinDebt[user] += stablecoinAmount
3. StableCoin.mint(user, stablecoinAmount)
```

**예시:**

- 담보: 150 DSTN (150,000 USD 가치)
- 발행 가능: 최대 100,000 USDST
- 계산: 150,000 / 1.5 = 100,000

### 2.3 스테이블 코인 상환 (Redeem)

```
실행:
1. StableCoin.burn(user, stablecoinAmount)
2. stablecoinDebt[user] -= stablecoinAmount
3. 담보비율 재계산 후 여유 담보만 인출 가능
```

**효과:**

- 부채 감소 → 담보비율 개선
- 담보 인출 가능량 증가

### 2.4 담보 인출 (Withdraw)

```
요구사항:
(collateral[user] - withdrawAmount) * DSTN_PRICE >= stablecoinDebt[user] * COLLATERAL_RATIO / 100

실행:
1. 담보비율 검증 (인출 후에도 150% 이상 유지)
2. collateral[user] -= amount
3. DSTN 전송
```

### 2.5 청산 (Liquidation)

```
조건:
collateral[user] * DSTN_PRICE < stablecoinDebt[user] * COLLATERAL_RATIO / 100

실행:
1. 담보 전액 청산자에게 전송
2. stablecoinDebt[user] = 0
3. 청산자에게 보너스 지급 (예: 5-10%)
```

**청산 메커니즘:**

- **public 메서드**: 누구나 `liquidate()` 호출 가능
- **청산 봇**: 자동으로 담보비율 모니터링 후 청산 실행
- **인센티브**: 청산 보너스로 수익 창출
- **시스템 안정성**: 빠른 청산으로 담보 부족 포지션 제거

**청산 봇 동작:**

1. 블록체인에서 담보비율 < 150%인 포지션 탐색
2. 자동으로 `liquidate()` 트랜잭션 제출
3. 청산 보너스 획득
4. 반복 실행

---

## 3. 데이터 구조

### 3.1 사용자 포지션

```solidity
struct UserPosition {
    uint256 collateral;      // 예치한 DSTN (Wei)
    uint256 stablecoinDebt;  // 발행한 스테이블 코인 (Wei)
    uint256 lastUpdateTime;  // 마지막 업데이트 시간
}

mapping(address => UserPosition) public positions;
```

### 3.2 상수 정의

```typescript
// blockchain.constants.ts
export const STABLECOIN_CONFIG = {
  DSTN_PRICE_USD: 1000, // 1 DSTN = 1000 USD
  COLLATERAL_RATIO: 150, // 150% (1.5배)
  LIQUIDATION_THRESHOLD: 150, // 청산 임계값
  LIQUIDATION_BONUS: 5, // 청산 보너스 5%
  STABLECOIN_DECIMALS: 18, // ERC20 decimals
};
```

---

## 4. 구현 순서

### Phase 1: 컨트랙트 구현

#### 4.1 Solidity 컨트랙트 작성

1. **StableCoin.sol** 작성
   - Solidity 0.8.x 사용
   - ERC20 표준 인터페이스 구현
   - mint/burn 함수 (onlyVault)
   - 권한 관리

2. **CollateralVault.sol** 작성
   - Solidity 0.8.x 사용
   - 모든 메서드 `public` (누구나 호출 가능)
   - 담보 예치/인출 로직
   - 담보비율 계산 함수
   - 스테이블 코인 발행/상환 로직
   - 청산 메커니즘 (public, 청산 봇이 자동 실행)

#### 4.2 컨트랙트 컴파일

- **Solidity 컴파일러 (solc)** 사용 (또는 Remix에서 직접 컴파일)
- 바이트코드 추출
- ABI 생성 (프론트엔드 연동용)
- 배포 준비 완료

### Phase 2: 코어 연동 및 API 구현

1. **컨트랙트 배포**
   - Solidity 컴파일된 바이트코드 사용
   - `ContractService.deployContract()` 호출
   - StableCoin 배포 (ERC20 토큰)
   - CollateralVault 배포 (StableCoin 주소 주입)
   - EVM에서 실행 (이더리움과 동일한 방식)

2. **Service 레이어**
   - `StablecoinService` 생성
   - Vault 상태 조회 메서드 (`eth_call` 사용)
   - 트랜잭션 생성 헬퍼 (`eth_sendTransaction` 사용)
   - ABI 인코딩/디코딩 유틸리티

3. **Controller 레이어**
   - `POST /contract/vault/deposit`
   - `POST /contract/vault/mint`
   - `POST /contract/vault/redeem`
   - `POST /contract/vault/withdraw`
   - `POST /contract/vault/liquidate`
   - `GET /contract/vault/position/:address`
   - `GET /contract/vault/health/:address`

### Phase 3: 프론트엔드 연동

1. **UI 컴포넌트**
   - 담보 예치 폼
   - 스테이블 코인 발행 폼
   - 포지션 조회 대시보드
   - 청산 알림

2. **상태 관리**
   - 사용자 포지션 실시간 조회
   - 담보비율 모니터링

3. **청산 봇 (선택사항)**
   - 백그라운드 서비스로 담보비율 모니터링
   - 자동 청산 트랜잭션 제출
   - 청산 보너스 수익 추적

---

## 5. API 엔드포인트 명세

### 5.1 담보 예치

```http
POST /contract/vault/deposit
Body: { "amount": "1000000000000000000" } // 1 DSTN in Wei
```

### 5.2 스테이블 코인 발행

```http
POST /contract/vault/mint
Body: { "amount": "1000000000000000000" } // 1 USDST in Wei
```

### 5.3 스테이블 코인 상환

```http
POST /contract/vault/redeem
Body: { "amount": "1000000000000000000" }
```

### 5.4 담보 인출

```http
POST /contract/vault/withdraw
Body: { "amount": "1000000000000000000" }
```

### 5.5 청산

```http
POST /contract/vault/liquidate
Body: { "targetAddress": "0x..." }
```

### 5.6 포지션 조회

```http
GET /contract/vault/position/:address
Response: {
  "collateral": "150000000000000000000",
  "stablecoinDebt": "100000000000000000000",
  "collateralRatio": 150,
  "healthFactor": 1.5
}
```

### 5.7 헬스 체크

```http
GET /contract/vault/health/:address
Response: {
  "isHealthy": true,
  "collateralRatio": 150,
  "liquidationThreshold": 150
}
```

---

## 6. 테스트 시나리오

### 6.1 정상 플로우

1. 사용자 A가 150 DSTN 예치
2. 100,000 USDST 발행 (150% 담보비율)
3. 50,000 USDST 상환
4. 50 DSTN 인출

### 6.2 청산 시나리오

1. 사용자 A가 150 DSTN 예치, 100,000 USDST 발행
2. 담보 가치 하락 (또는 부채 증가)으로 담보비율 < 150%
3. **청산 봇이 자동으로 탐지** (또는 청산자 B가 수동 실행)
4. `liquidate()` 트랜잭션 제출 (public 메서드이므로 누구나 가능)
5. 담보 전액 + 보너스 획득

---

## 참고 자료

- **MakerDAO (DAI)**: 가장 유명한 담보형 스테이블 코인
- **Liquity Protocol**: 무이자 대출 + 청산 메커니즘
- **ERC20 표준**: https://eips.ethereum.org/EIPS/eip-20
- **Solidity 문서**: https://docs.soliditylang.org/
- **EthereumJS VM**: https://github.com/ethereumjs/ethereumjs-monorepo
- **이더리움 호환성**: 이더리움 메인넷과 동일한 EVM 바이트코드 실행
