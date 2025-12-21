# 스테이블코인 Vault API 설계 문서

## 1. 현재 상황 분석

### 1.1 기존 구조
- **ContractService**: 컨트랙트 호출 로직 (`callContract`, `executeContract`)
- **ContractController**: 기본 컨트랙트 API (`/contract/call`, `/contract/execute`)
- **TransactionService**: 트랜잭션 서명 및 제출 (`signTransaction`, `submitTransaction`)

### 1.2 문제점
1. **executeContract()의 한계**
   - 제네시스 계정 0번만 사용 (하드코딩)
   - 사용자별 트랜잭션 처리 불가
   - `depositCollateral()`은 `payable`이므로 `value` 전송 필요

2. **ABI 디코딩 부재**
   - `callContract()`는 hex string만 반환
   - 스캔 백엔드에서 디코딩 예정이지만, 코어에서도 기본 처리 필요

### 1.3 해결 방안
1. **StablecoinService 생성**
   - Vault 컨트랙트 전용 비즈니스 로직
   - 사용자 주소 기반 트랜잭션 처리
   - ABI 인코딩/디코딩 (선택적)

2. **VaultController 생성**
   - RESTful API 엔드포인트
   - 사용자 친화적인 인터페이스

3. **사용자 인증 방식**
   - **옵션 A**: 개인키를 요청에 포함 (테스트용, 현재 방식)
   - **옵션 B**: 서명된 트랜잭션을 받아서 제출만 (프로덕션)
   - **현재는 옵션 A로 진행** (기존 코드베이스와 일관성)

## 2. API 설계

### 2.1 엔드포인트 목록

#### 상태 변경 (POST)
```
POST /contract/vault/deposit
POST /contract/vault/mint
POST /contract/vault/redeem
POST /contract/vault/withdraw
POST /contract/vault/liquidate
```

#### 조회 (GET)
```
GET /contract/vault/position/:address
GET /contract/vault/health/:address
```

### 2.2 API 상세

#### POST /contract/vault/deposit - 담보 예치
**요청:**
```json
{
  "userAddress": "0x...",
  "amount": "1000000000000000000",  // Wei 단위
  "privateKey": "0x..."  // 테스트용
}
```

**응답:**
```json
{
  "txHash": "0x...",
  "status": "pending"
}
```

**로직:**
1. Vault 주소 조회 (`deployed-contracts.json`)
2. `depositCollateral()` 호출 (payable, value = amount)
3. 사용자 개인키로 트랜잭션 서명 및 제출

#### POST /contract/vault/mint - 스테이블코인 발행
**요청:**
```json
{
  "userAddress": "0x...",
  "amount": "500000000000000000",  // 발행할 스테이블코인 양
  "privateKey": "0x..."
}
```

**응답:**
```json
{
  "txHash": "0x...",
  "status": "pending"
}
```

**로직:**
1. Vault 주소 조회
2. `mintStablecoin(uint256)` 호출
3. 트랜잭션 서명 및 제출

#### POST /contract/vault/redeem - 스테이블코인 상환
**요청:**
```json
{
  "userAddress": "0x...",
  "amount": "500000000000000000",
  "privateKey": "0x..."
}
```

**응답:**
```json
{
  "txHash": "0x...",
  "status": "pending"
}
```

**로직:**
1. Vault 주소 조회
2. `redeemStablecoin(uint256)` 호출
3. 트랜잭션 서명 및 제출

#### POST /contract/vault/withdraw - 담보 인출
**요청:**
```json
{
  "userAddress": "0x...",
  "amount": "1000000000000000000",
  "privateKey": "0x..."
}
```

**응답:**
```json
{
  "txHash": "0x...",
  "status": "pending"
}
```

**로직:**
1. Vault 주소 조회
2. `withdrawCollateral(uint256)` 호출
3. 트랜잭션 서명 및 제출

#### POST /contract/vault/liquidate - 청산
**요청:**
```json
{
  "liquidatorAddress": "0x...",  // 청산자 주소
  "targetAddress": "0x...",      // 청산 대상 주소
  "privateKey": "0x..."          // 청산자의 개인키
}
```

**응답:**
```json
{
  "txHash": "0x...",
  "status": "pending"
}
```

**로직:**
1. Vault 주소 조회
2. `liquidate(address)` 호출
3. 트랜잭션 서명 및 제출

#### GET /contract/vault/position/:address - 포지션 조회
**응답:**
```json
{
  "result": "0x00000000000000000000000000000000000000000000000021e19e0c9bab2400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000..."
}
```

**로직:**
1. Vault 주소 조회
2. `getPosition(address)` 호출 (`eth_call`)
3. hex string 반환 (디코딩은 스캔 백엔드에서)

#### GET /contract/vault/health/:address - 건강 상태 조회
**응답:**
```json
{
  "result": "0x0000000000000000000000000000000000000000000000000000000000000001"
}
```

**로직:**
1. Vault 주소 조회
2. `isHealthy(address)` 호출 (`eth_call`)
3. hex string 반환 (디코딩은 스캔 백엔드에서)

## 3. 구현 계획

### 3.1 파일 구조
```
src/contract/
├── contract.service.ts          # 기존 (유지)
├── contract.controller.ts       # 기존 (유지)
├── stablecoin.service.ts         # 신규 생성
├── vault.controller.ts          # 신규 생성
└── dto/
    ├── deposit.dto.ts           # 신규
    ├── mint.dto.ts              # 신규
    ├── redeem.dto.ts            # 신규
    ├── withdraw.dto.ts          # 신규
    ├── liquidate.dto.ts         # 신규
    └── position.dto.ts          # 신규
```

### 3.2 StablecoinService 구조

```typescript
@Injectable()
export class StablecoinService {
  constructor(
    private readonly contractService: ContractService,
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
  ) {}

  // Vault 주소 조회 (deployed-contracts.json)
  private getVaultAddress(): string {
    const contracts = this.contractService.getDeployedContracts();
    if (!contracts?.vault?.address) {
      throw new Error('Vault contract not deployed');
    }
    return contracts.vault.address;
  }

  // 상태 변경 메서드들 (executeContract 사용)
  async depositCollateral(userAddress: string, amount: bigint, privateKey: string): Promise<{ txHash: string }>
  async mintStablecoin(userAddress: string, amount: bigint, privateKey: string): Promise<{ txHash: string }>
  async redeemStablecoin(userAddress: string, amount: bigint, privateKey: string): Promise<{ txHash: string }>
  async withdrawCollateral(userAddress: string, amount: bigint, privateKey: string): Promise<{ txHash: string }>
  async liquidate(liquidatorAddress: string, targetAddress: string, privateKey: string): Promise<{ txHash: string }>

  // 조회 메서드들 (callContract 사용)
  async getPosition(userAddress: string): Promise<{ result: string }>
  async isHealthy(userAddress: string): Promise<{ result: string }>
}
```

### 3.3 주요 고려사항

1. **depositCollateral의 특수성**
   - `payable` 함수이므로 `value` 전송 필요
   - `executeContract()`는 `value`를 지원하지 않음
   - **해결**: `TransactionService.signTransaction()` 직접 사용

2. **사용자 인증**
   - 현재는 개인키를 요청에 포함 (테스트용)
   - 프로덕션에서는 서명된 트랜잭션만 받아야 함

3. **에러 처리**
   - Vault 미배포 시 에러
   - 잔액 부족 시 에러
   - 담보비율 부족 시 에러

4. **ABI 디코딩**
   - 현재는 hex string만 반환
   - 스캔 백엔드에서 디코딩 예정
   - 필요시 나중에 추가 가능

## 4. 다음 단계

1. ✅ 설계 문서 작성 (현재)
2. ⏳ StablecoinService 구현
3. ⏳ VaultController 구현
4. ⏳ DTO 클래스 생성
5. ⏳ 모듈 등록 및 테스트

