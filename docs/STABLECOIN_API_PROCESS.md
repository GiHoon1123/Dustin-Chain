# 스테이블코인 API 프로세스 문서

## 개요

이 문서는 스테이블코인 시스템의 각 API 엔드포인트가 어떻게 동작하는지 상세히 설명합니다.

## API 목록

1. [담보 예치 (Deposit Collateral)](#1-담보-예치-deposit-collateral)
2. [스테이블코인 발행 (Mint Stablecoin)](#2-스테이블코인-발행-mint-stablecoin)
3. [스테이블코인 상환 (Redeem Stablecoin)](#3-스테이블코인-상환-redeem-stablecoin)
4. [담보 인출 (Withdraw Collateral)](#4-담보-인출-withdraw-collateral)
5. [청산 (Liquidate)](#5-청산-liquidate)
6. [포지션 조회 (Get Position)](#6-포지션-조회-get-position)
7. [건강도 확인 (Get Health)](#7-건강도-확인-get-health)

---

## 1. 담보 예치 (Deposit Collateral)

### API 엔드포인트
```
POST /stablecoin/deposit
```

### 요청 Body
```json
{
  "privateKey": "0x...",
  "amount": "1000000000000000000000"
}
```

### 프로세스

1. **요청 검증**
   - `privateKey` 형식 검증 (0x + 64 hex characters)
   - `amount` 형식 검증 (숫자 문자열)

2. **배포된 컨트랙트 주소 조회**
   - `deployed-contracts.json` 파일에서 `CollateralVault` 주소 읽기
   - 주소가 없으면 에러 반환

3. **함수 호출 데이터 생성**
   - 함수명: `depositCollateral()`
   - 파라미터: 없음 (payable 함수)
   - ABI 인코딩:
     - 함수 선택자: `keccak256("depositCollateral()")[0:4]`
     - 데이터: 함수 선택자만 포함 (파라미터 없음)

4. **트랜잭션 생성 및 제출**
   - `executeContractByUser()` 호출
   - 사용자 개인키로 트랜잭션 서명
   - `value`: `amount` (Wei 단위) - 담보로 전송할 DSTN 양
   - `to`: CollateralVault 주소
   - `data`: ABI 인코딩된 함수 호출 데이터
   - 트랜잭션을 Mempool에 제출

5. **컨트랙트 실행 (블록 생성 시)**
   - `CollateralVault.depositCollateral()` 실행
   - `msg.value` 확인 (0보다 커야 함)
   - `collateral[msg.sender] += msg.value` (사용자 담보 증가)
   - `DepositCollateral` 이벤트 발생

6. **응답 반환**
   ```json
   {
     "hash": "0x...",
     "status": "pending"
   }
   ```

### 주의사항
- `depositCollateral()`은 payable 함수이므로 트랜잭션의 `value` 필드에 담보 금액을 포함해야 합니다.
- 트랜잭션이 블록에 포함되기 전까지는 상태 변경이 반영되지 않습니다.

---

## 2. 스테이블코인 발행 (Mint Stablecoin)

### API 엔드포인트
```
POST /stablecoin/mint
```

### 요청 Body
```json
{
  "privateKey": "0x...",
  "stablecoinAmount": "500000000000000000000"
}
```

### 프로세스

1. **요청 검증**
   - `privateKey` 형식 검증
   - `stablecoinAmount` 형식 검증

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `mintStablecoin(uint256)`
   - 파라미터: `[stablecoinAmount]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("mintStablecoin(uint256)")[0:4]`
     - 파라미터 인코딩: `stablecoinAmount`를 32바이트 빅엔디안으로 인코딩

4. **트랜잭션 생성 및 제출**
   - `executeContractByUser()` 호출
   - 사용자 개인키로 트랜잭션 서명
   - `value`: `0` (DSTN 전송 없음)
   - `to`: CollateralVault 주소
   - `data`: ABI 인코딩된 함수 호출 데이터

5. **컨트랙트 실행 (블록 생성 시)**
   - `CollateralVault.mintStablecoin(uint256)` 실행
   - 담보 가치 계산: `collateral[user] * DSTN_PRICE / 1e18`
   - 필요 담보 계산: `stablecoinAmount * COLLATERAL_RATIO / 100`
   - 담보비율 검증: `담보 가치 >= 필요 담보` (150% 이상)
   - `stablecoinDebt[user] += stablecoinAmount` (부채 증가)
   - `StableCoin.mint(user, stablecoinAmount)` 호출 (스테이블코인 발행)
   - `MintStablecoin` 이벤트 발생

6. **응답 반환**
   ```json
   {
     "hash": "0x...",
     "status": "pending"
   }
   ```

### 주의사항
- 담보비율이 150% 미만이면 트랜잭션이 실패합니다.
- 발행된 스테이블코인은 사용자 주소로 전송됩니다.

---

## 3. 스테이블코인 상환 (Redeem Stablecoin)

### API 엔드포인트
```
POST /stablecoin/redeem
```

### 요청 Body
```json
{
  "privateKey": "0x...",
  "stablecoinAmount": "500000000000000000000"
}
```

### 프로세스

1. **요청 검증**
   - `privateKey` 형식 검증
   - `stablecoinAmount` 형식 검증

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `redeemStablecoin(uint256)`
   - 파라미터: `[stablecoinAmount]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("redeemStablecoin(uint256)")[0:4]`
     - 파라미터 인코딩: `stablecoinAmount`를 32바이트 빅엔디안으로 인코딩

4. **트랜잭션 생성 및 제출**
   - `executeContractByUser()` 호출
   - 사용자 개인키로 트랜잭션 서명
   - `value`: `0`
   - `to`: CollateralVault 주소
   - `data`: ABI 인코딩된 함수 호출 데이터

5. **컨트랙트 실행 (블록 생성 시)**
   - `CollateralVault.redeemStablecoin(uint256)` 실행
   - `stablecoinDebt[user] >= stablecoinAmount` 검증 (부채 충분한지 확인)
   - `stablecoinDebt[user] -= stablecoinAmount` (부채 감소)
   - `StableCoin.burnFrom(user, stablecoinAmount)` 호출 (스테이블코인 소각)
   - `RedeemStablecoin` 이벤트 발생

6. **응답 반환**
   ```json
   {
     "hash": "0x...",
     "status": "pending"
   }
   ```

### 주의사항
- 상환하려는 양이 현재 부채보다 크면 트랜잭션이 실패합니다.
- 상환 후 담보비율이 개선되어 담보 인출이 가능해질 수 있습니다.

---

## 4. 담보 인출 (Withdraw Collateral)

### API 엔드포인트
```
POST /stablecoin/withdraw
```

### 요청 Body
```json
{
  "privateKey": "0x...",
  "amount": "1000000000000000000000"
}
```

### 프로세스

1. **요청 검증**
   - `privateKey` 형식 검증
   - `amount` 형식 검증

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `withdrawCollateral(uint256)`
   - 파라미터: `[amount]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("withdrawCollateral(uint256)")[0:4]`
     - 파라미터 인코딩: `amount`를 32바이트 빅엔디안으로 인코딩

4. **트랜잭션 생성 및 제출**
   - `executeContractByUser()` 호출
   - 사용자 개인키로 트랜잭션 서명
   - `value`: `0`
   - `to`: CollateralVault 주소
   - `data`: ABI 인코딩된 함수 호출 데이터

5. **컨트랙트 실행 (블록 생성 시)**
   - `CollateralVault.withdrawCollateral(uint256)` 실행
   - `collateral[user] >= amount` 검증 (담보 충분한지 확인)
   - 담보 가치 계산: `(collateral[user] - amount) * DSTN_PRICE / 1e18`
   - 필요 담보 계산: `stablecoinDebt[user] * COLLATERAL_RATIO / 100`
   - 담보비율 검증: `담보 가치 >= 필요 담보` (150% 이상 유지)
   - `collateral[user] -= amount` (담보 감소)
   - `msg.sender.transfer(amount)` (DSTN 전송)
   - `WithdrawCollateral` 이벤트 발생

6. **응답 반환**
   ```json
   {
     "hash": "0x...",
     "status": "pending"
   }
   ```

### 주의사항
- 담보 인출 후에도 담보비율이 150% 이상 유지되어야 합니다.
- 인출하려는 양이 현재 담보보다 크면 트랜잭션이 실패합니다.

---

## 5. 청산 (Liquidate)

### API 엔드포인트
```
POST /stablecoin/liquidate
```

### 요청 Body
```json
{
  "privateKey": "0x...",
  "userAddress": "0x..."
}
```

### 프로세스

1. **요청 검증**
   - `privateKey` 형식 검증 (청산 실행자)
   - `userAddress` 형식 검증 (청산 대상)

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `liquidate(address)`
   - 파라미터: `[userAddress]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("liquidate(address)")[0:4]`
     - 파라미터 인코딩: `userAddress`를 32바이트로 패딩

4. **트랜잭션 생성 및 제출**
   - `executeContractByUser()` 호출
   - 청산 실행자 개인키로 트랜잭션 서명
   - `value`: `0`
   - `to`: CollateralVault 주소
   - `data`: ABI 인코딩된 함수 호출 데이터

5. **컨트랙트 실행 (블록 생성 시)**
   - `CollateralVault.liquidate(address)` 실행
   - 담보 가치 계산: `collateral[user] * DSTN_PRICE / 1e18`
   - 필요 담보 계산: `stablecoinDebt[user] * COLLATERAL_RATIO / 100`
   - 담보비율 검증: `담보 가치 < 필요 담보` (150% 미만이어야 청산 가능)
   - 청산 실행자에게 담보 전송
   - 부채 소각
   - `Liquidate` 이벤트 발생

6. **응답 반환**
   ```json
   {
     "hash": "0x...",
     "status": "pending"
   }
   ```

### 주의사항
- 담보비율이 150% 이상인 포지션은 청산할 수 없습니다.
- 청산 실행자는 담보를 받고, 청산 대상자의 부채가 소각됩니다.

---

## 6. 포지션 조회 (Get Position)

### API 엔드포인트
```
GET /stablecoin/position/:userAddress
```

### 프로세스

1. **요청 검증**
   - `userAddress` 형식 검증 (URL 파라미터)

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `getPosition(address)`
   - 파라미터: `[userAddress]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("getPosition(address)")[0:4]`
     - 파라미터 인코딩: `userAddress`를 32바이트로 패딩

4. **View 함수 호출 (eth_call)**
   - `callContract()` 호출
   - 상태 변경 없이 실행 (읽기 전용)
   - VM에서 `CollateralVault.getPosition(address)` 실행
   - 반환값: `(uint256 collateralAmount, uint256 debtAmount, uint256 collateralRatio)`
   - 결과는 hex 문자열로 반환됨

5. **응답 반환**
   ```json
   {
     "collateralAmount": "0x...",
     "debtAmount": "0x...",
     "collateralRatio": "0x..."
   }
   ```

### 주의사항
- View 함수이므로 트랜잭션이 생성되지 않습니다.
- 결과는 hex 문자열로 반환되며, 디코딩은 스캔 백엔드에서 처리합니다.

---

## 7. 건강도 확인 (Get Health)

### API 엔드포인트
```
GET /stablecoin/health/:userAddress
```

### 프로세스

1. **요청 검증**
   - `userAddress` 형식 검증 (URL 파라미터)

2. **배포된 컨트랙트 주소 조회**
   - `CollateralVault` 주소 읽기

3. **함수 호출 데이터 생성**
   - 함수명: `isHealthy(address)`
   - 파라미터: `[userAddress]`
   - ABI 인코딩:
     - 함수 선택자: `keccak256("isHealthy(address)")[0:4]`
     - 파라미터 인코딩: `userAddress`를 32바이트로 패딩

4. **View 함수 호출 (eth_call)**
   - `callContract()` 호출
   - 상태 변경 없이 실행 (읽기 전용)
   - VM에서 `CollateralVault.isHealthy(address)` 실행
   - 반환값: `bool` (담보비율 150% 이상이면 `true`)
   - 결과는 hex 문자열로 반환됨

5. **응답 반환**
   ```json
   {
     "isHealthy": true
   }
   ```

### 주의사항
- View 함수이므로 트랜잭션이 생성되지 않습니다.
- `isHealthy`는 담보비율이 150% 이상인지 확인합니다.

---

## 공통 프로세스

### 트랜잭션 제출 흐름

1. **서명 생성**
   - 사용자 개인키로 트랜잭션 서명
   - Nonce 자동 계산 (계정 nonce + pending 트랜잭션 고려)

2. **트랜잭션 검증**
   - 서명 검증 (발신자 확인)
   - Nonce 검증
   - 잔액 검증 (가스비 포함)

3. **Mempool 추가**
   - 검증 통과 시 Mempool에 추가
   - `pending` 상태로 반환

4. **블록 생성 시 실행**
   - Validator가 블록 생성 시 트랜잭션 포함
   - VM에서 컨트랙트 실행
   - 상태 변경 반영

### View 함수 호출 흐름

1. **eth_call 실행**
   - 별도의 VM 인스턴스 사용
   - Checkpoint 생성 (상태 변경 취소용)

2. **컨트랙트 실행**
   - 상태 변경 없이 함수 실행
   - 반환값만 수집

3. **Checkpoint 복구**
   - 상태 변경 취소
   - 원래 상태로 복원

4. **결과 반환**
   - hex 문자열로 반환
   - 디코딩은 스캔 백엔드에서 처리

---

## 에러 처리

### 일반적인 에러

1. **컨트랙트 미배포**
   - `CollateralVault is not deployed`
   - 해결: `/contract/deploy-stablecoin-system` 호출

2. **잔액 부족**
   - 트랜잭션 가스비를 지불할 수 없음
   - 해결: 계정에 충분한 DSTN 보유

3. **담보비율 부족**
   - 발행/인출 시 담보비율 150% 미만
   - 해결: 더 많은 담보 예치 또는 부채 상환

4. **부채 부족**
   - 상환하려는 양이 현재 부채보다 큼
   - 해결: 상환 양 조정

### 트랜잭션 실패

- 컨트랙트 실행 중 `require()` 실패 시 트랜잭션이 실패합니다.
- 트랜잭션 해시는 반환되지만, 블록에 포함되어 실행될 때 실패할 수 있습니다.
- 트랜잭션 receipt를 확인하여 성공/실패 여부를 확인할 수 있습니다.

---

## 참고사항

- 모든 금액은 Wei 단위로 전달됩니다 (1 DSTN = 10^18 Wei).
- 트랜잭션은 블록에 포함되기 전까지는 상태 변경이 반영되지 않습니다.
- View 함수는 즉시 결과를 반환하지만, 트랜잭션은 블록 생성까지 대기해야 합니다.
- ABI 디코딩은 스캔 백엔드에서 처리하므로, 코어는 hex 문자열만 반환합니다.

