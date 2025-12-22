# 🎯 스테이킹 시스템 설계 문서

## 📋 목차
1. [개요](#개요)
2. [이더리움 PoS 스테이킹 참고](#이더리움-pos-스테이킹-참고)
3. [시스템 아키텍처](#시스템-아키텍처)
4. [스마트 컨트랙트 설계](#스마트-컨트랙트-설계)
5. [백엔드 API 설계](#백엔드-api-설계)
6. [데이터 모델](#데이터-모델)
7. [보상 시스템](#보상-시스템)
8. [슬래싱 (Slashing)](#슬래싱-slashing)
9. [출금 (Withdrawal)](#출금-withdrawal)
10. [구현 단계](#구현-단계)

---

## 개요

### 목표
이더리움 PoS (Proof of Stake) 기반 스테이킹 시스템을 구현하여:
- 사용자가 DSTN을 스테이킹하여 Validator가 될 수 있도록 함
- 스테이킹된 자산에 대한 보상 지급
- 악의적 행동에 대한 슬래싱 (페널티)
- 안전한 출금 메커니즘 제공

### 핵심 원칙
1. **최소 스테이킹 금액**: 32 DSTN (이더리움 32 ETH와 동일)
2. **보안 우선**: 슬래싱으로 악의적 행동 방지
3. **탈중앙화**: 누구나 Validator가 될 수 있음
4. **투명성**: 모든 스테이킹 정보는 온체인에 저장

---

## 이더리움 PoS 스테이킹 참고

### 이더리움 스테이킹 프로세스

#### 1. Deposit (예치)
```
사용자 → Deposit Contract (0x00000000219ab540356cBB839Cbe05303d7705Fa)
  - 최소 32 ETH 예치
  - Validator 키 쌍 생성 (withdrawal key, signing key)
  - Validator 등록 정보 제출
```

#### 2. Activation (활성화)
```
- Beacon Chain에서 Validator 등록 확인
- 활성화 대기열 (Activation Queue) 대기
- 활성화되면 블록 제안/검증 가능
```

#### 3. Block Proposal & Attestation
```
- Proposer 선택 시: 블록 제안 → 보상
- Committee 선택 시: Attestation 제출 → 보상
```

#### 4. Rewards (보상)
```
- Base Reward: 네트워크 참여 보상
- Proposer Reward: 블록 제안 보상
- Attestation Reward: 블록 검증 보상
- Max Reward: 약 4.5% APY (연간 수익률)
```

#### 5. Slashing (슬래싱)
```
악의적 행동 시:
- Double Vote: 같은 슬롯에 두 개의 Attestation
- Surround Vote: 잘못된 체인 선택
- 페널티: 스테이킹 금액의 일부 또는 전부 삭감
```

#### 6. Withdrawal (출금)
```
- Exit Queue: 출금 요청 후 대기
- Withdrawal Delay: 약 27시간 (이더리움)
- Partial Withdrawal: 보상만 인출 (32 ETH 유지)
- Full Withdrawal: 전체 인출 (Validator 비활성화)
```

---

## 시스템 아키텍처

### 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                    사용자 (User)                         │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              스테이킹 API (Backend)                      │
│  - POST /staking/deposit                                 │
│  - POST /staking/withdraw                                │
│  - GET  /staking/validator/:address                      │
│  - GET  /staking/rewards/:address                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            스테이킹 컨트랙트 (StakingContract)            │
│  - deposit()      : 스테이킹 예치                        │
│  - withdraw()     : 출금 요청                            │
│  - slash()        : 슬래싱 (관리자만)                    │
│  - getValidator() : Validator 정보 조회                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│            Validator Registry (Backend)                 │
│  - Validator 등록/활성화 관리                           │
│  - Proposer/Committee 선택 시 스테이킹 가중치 반영       │
│  - 보상 계산 및 지급                                     │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         Block Producer (합의 메커니즘)                   │
│  - 스테이킹 가중치 기반 Proposer/Committee 선택         │
│  - 블록 생성 시 보상 지급                                │
└─────────────────────────────────────────────────────────┘
```

### 컴포넌트별 역할

#### 1. StakingContract (스마트 컨트랙트)
- **역할**: 스테이킹 자산 관리, Validator 등록, 출금 처리
- **저장 데이터**: 
  - `validators[address]`: Validator 정보 (stakedAmount, status, etc.)
  - `totalStaked`: 전체 스테이킹 금액
  - `withdrawalQueue`: 출금 대기열

#### 2. StakingService (Backend)
- **역할**: 스테이킹 로직 처리, Validator Registry 관리
- **기능**:
  - 스테이킹 트랜잭션 생성 및 제출
  - Validator 상태 관리 (pending → active)
  - 보상 계산 및 지급
  - 출금 요청 처리

#### 3. ValidatorService (기존, 확장)
- **역할**: Proposer/Committee 선택 시 스테이킹 가중치 반영
- **변경사항**:
  - Genesis Validator → 동적 Validator Registry
  - 스테이킹 금액 기반 가중치 선택 알고리즘

#### 4. BlockProducer (기존, 확장)
- **역할**: 블록 생성 시 보상 지급
- **변경사항**:
  - Proposer 보상: StakingContract를 통해 지급
  - Committee 보상: StakingContract를 통해 지급

---

## 스마트 컨트랙트 설계

### StakingContract.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract StakingContract {
    // 상수
    uint256 public constant MIN_STAKE = 32 * 10**18; // 32 DSTN (Wei)
    uint256 public constant WITHDRAWAL_DELAY = 256; // 블록 수 (약 51분)
    
    // Validator 상태
    enum ValidatorStatus {
        Inactive,    // 비활성
        Pending,     // 활성화 대기
        Active,      // 활성 (블록 제안/검증 가능)
        Exiting,     // 출금 대기 중
        Withdrawn    // 출금 완료
    }
    
    // Validator 정보
    struct Validator {
        address validatorAddress;  // Validator 주소
        uint256 stakedAmount;      // 스테이킹 금액 (Wei)
        ValidatorStatus status;    // 상태
        uint256 activatedAt;       // 활성화된 블록 번호
        uint256 exitRequestedAt;   // 출금 요청 블록 번호
        uint256 totalRewards;      // 누적 보상 (Wei)
        uint256 slashedAmount;     // 슬래싱된 금액 (Wei)
    }
    
    // 매핑
    mapping(address => Validator) public validators;
    address[] public validatorList; // 활성 Validator 목록
    
    // 전체 통계
    uint256 public totalStaked;     // 전체 스테이킹 금액
    uint256 public totalRewards;    // 전체 지급된 보상
    
    // 관리자 (Vault 주소 또는 별도 관리자)
    address public admin;
    
    // 이벤트
    event Deposited(address indexed validator, uint256 amount);
    event Activated(address indexed validator, uint256 blockNumber);
    event WithdrawalRequested(address indexed validator, uint256 blockNumber);
    event Withdrawn(address indexed validator, uint256 amount);
    event Rewarded(address indexed validator, uint256 amount);
    event Slashed(address indexed validator, uint256 amount, string reason);
    
    // Modifier
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    // 생성자
    constructor() {
        admin = msg.sender;
    }
    
    /**
     * 스테이킹 예치
     * 
     * 요구사항:
     * - 최소 32 DSTN
     * - 이미 등록된 Validator는 추가 예치 가능
     */
    function deposit() external payable {
        require(msg.value >= MIN_STAKE, "Minimum stake is 32 DSTN");
        
        Validator storage validator = validators[msg.sender];
        
        if (validator.validatorAddress == address(0)) {
            // 새 Validator 등록
            validator.validatorAddress = msg.sender;
            validator.stakedAmount = msg.value;
            validator.status = ValidatorStatus.Pending;
            validatorList.push(msg.sender);
        } else {
            // 기존 Validator 추가 예치
            require(
                validator.status == ValidatorStatus.Active ||
                validator.status == ValidatorStatus.Pending,
                "Cannot deposit in current status"
            );
            validator.stakedAmount += msg.value;
        }
        
        totalStaked += msg.value;
        
        emit Deposited(msg.sender, msg.value);
    }
    
    /**
     * Validator 활성화 (Backend에서 호출)
     * 
     * 활성화 조건:
     * - Pending 상태
     * - 최소 스테이킹 금액 충족
     */
    function activateValidator(address validatorAddress) external onlyAdmin {
        Validator storage validator = validators[validatorAddress];
        require(validator.status == ValidatorStatus.Pending, "Not pending");
        require(validator.stakedAmount >= MIN_STAKE, "Insufficient stake");
        
        validator.status = ValidatorStatus.Active;
        validator.activatedAt = block.number;
        
        emit Activated(validatorAddress, block.number);
    }
    
    /**
     * 출금 요청
     * 
     * 프로세스:
     * 1. Active → Exiting 상태 변경
     * 2. WITHDRAWAL_DELAY 블록 대기
     * 3. withdraw() 호출하여 실제 출금
     */
    function requestWithdrawal() external {
        Validator storage validator = validators[msg.sender];
        require(validator.status == ValidatorStatus.Active, "Not active");
        
        validator.status = ValidatorStatus.Exiting;
        validator.exitRequestedAt = block.number;
        
        emit WithdrawalRequested(msg.sender, block.number);
    }
    
    /**
     * 출금 실행
     * 
     * 요구사항:
     * - Exiting 상태
     * - WITHDRAWAL_DELAY 블록 경과
     */
    function withdraw() external {
        Validator storage validator = validators[msg.sender];
        require(validator.status == ValidatorStatus.Exiting, "Not exiting");
        require(
            block.number >= validator.exitRequestedAt + WITHDRAWAL_DELAY,
            "Withdrawal delay not met"
        );
        
        uint256 withdrawableAmount = validator.stakedAmount - validator.slashedAmount;
        require(withdrawableAmount > 0, "No withdrawable amount");
        
        validator.status = ValidatorStatus.Withdrawn;
        validator.stakedAmount = 0;
        totalStaked -= withdrawableAmount;
        
        // Validator 목록에서 제거
        _removeFromValidatorList(msg.sender);
        
        payable(msg.sender).transfer(withdrawableAmount);
        
        emit Withdrawn(msg.sender, withdrawableAmount);
    }
    
    /**
     * 보상 지급 (Backend에서 호출)
     * 
     * 호출 시점:
     * - 블록 생성 시 Proposer 보상
     * - Attestation 제출 시 Committee 보상
     */
    function rewardValidator(address validatorAddress, uint256 amount) external onlyAdmin {
        Validator storage validator = validators[validatorAddress];
        require(validator.status == ValidatorStatus.Active, "Not active");
        
        validator.totalRewards += amount;
        totalRewards += amount;
        
        // 보상을 Validator 주소로 전송
        payable(validatorAddress).transfer(amount);
        
        emit Rewarded(validatorAddress, amount);
    }
    
    /**
     * 슬래싱 (Backend에서 호출)
     * 
     * 슬래싱 사유:
     * - Double Vote: 같은 슬롯에 두 개의 Attestation
     * - Surround Vote: 잘못된 체인 선택
     * - Offline: 오프라인 상태로 인한 누락
     */
    function slashValidator(
        address validatorAddress,
        uint256 amount,
        string memory reason
    ) external onlyAdmin {
        Validator storage validator = validators[validatorAddress];
        require(validator.status == ValidatorStatus.Active, "Not active");
        require(amount <= validator.stakedAmount, "Amount exceeds stake");
        
        validator.slashedAmount += amount;
        validator.stakedAmount -= amount;
        totalStaked -= amount;
        
        // 슬래싱된 금액은 소각 (또는 슬래싱 풀로 이동)
        // payable(address(0)).transfer(amount); // 소각
        
        emit Slashed(validatorAddress, amount, reason);
    }
    
    /**
     * Validator 정보 조회
     */
    function getValidator(address validatorAddress)
        external
        view
        returns (Validator memory)
    {
        return validators[validatorAddress];
    }
    
    /**
     * 활성 Validator 목록 조회
     */
    function getActiveValidators() external view returns (address[] memory) {
        address[] memory active = new address[](validatorList.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (validators[validatorList[i]].status == ValidatorStatus.Active) {
                active[count] = validatorList[i];
                count++;
            }
        }
        
        // 배열 크기 조정
        assembly {
            mstore(active, count)
        }
        
        return active;
    }
    
    /**
     * Validator 목록에서 제거 (내부 함수)
     */
    function _removeFromValidatorList(address validatorAddress) private {
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (validatorList[i] == validatorAddress) {
                validatorList[i] = validatorList[validatorList.length - 1];
                validatorList.pop();
                break;
            }
        }
    }
}
```

---

## 백엔드 API 설계

### 1. 스테이킹 예치

**POST /staking/deposit**

```typescript
Request:
{
  "privateKey": "0x...",  // 사용자 개인키
  "amount": "0x8ac7230489e80000"  // 스테이킹 금액 (Wei, Hex String)
  // 최소 32 DSTN = 32 * 10^18 Wei
}

Response:
{
  "hash": "0x...",        // 트랜잭션 해시
  "status": "pending",    // 트랜잭션 상태
  "validatorAddress": "0x...",  // Validator 주소
  "message": "Deposit successful. Validator will be activated after confirmation."
}
```

### 2. 출금 요청

**POST /staking/withdraw-request**

```typescript
Request:
{
  "privateKey": "0x..."  // Validator 개인키
}

Response:
{
  "hash": "0x...",
  "status": "pending",
  "exitRequestedAt": 12345,  // 출금 요청 블록 번호
  "withdrawableAt": 12601,   // 출금 가능 블록 번호 (exitRequestedAt + WITHDRAWAL_DELAY)
  "message": "Withdrawal requested. You can withdraw after 256 blocks."
}
```

### 3. 출금 실행

**POST /staking/withdraw**

```typescript
Request:
{
  "privateKey": "0x..."  // Validator 개인키
}

Response:
{
  "hash": "0x...",
  "status": "pending",
  "amount": "0x8ac7230489e80000",  // 출금 금액 (Wei, Hex String)
  "message": "Withdrawal successful."
}
```

### 4. Validator 정보 조회

**GET /staking/validator/:address**

```typescript
Response:
{
  "validatorAddress": "0x...",
  "stakedAmount": "0x8ac7230489e80000",  // 스테이킹 금액 (Wei, Hex String)
  "status": "active",  // inactive | pending | active | exiting | withdrawn
  "activatedAt": 1000,  // 활성화된 블록 번호
  "exitRequestedAt": null,  // 출금 요청 블록 번호 (없으면 null)
  "totalRewards": "0x16345785d8a0000",  // 누적 보상 (Wei, Hex String)
  "slashedAmount": "0x0",  // 슬래싱된 금액 (Wei, Hex String)
  "withdrawableAt": null  // 출금 가능 블록 번호 (없으면 null)
}
```

### 5. 보상 조회

**GET /staking/rewards/:address**

```typescript
Response:
{
  "validatorAddress": "0x...",
  "totalRewards": "0x16345785d8a0000",  // 누적 보상 (Wei, Hex String)
  "pendingRewards": "0x0",  // 대기 중인 보상 (Wei, Hex String)
  "estimatedAPY": "4.5"  // 예상 연간 수익률 (%)
}
```

### 6. 전체 스테이킹 통계

**GET /staking/stats**

```typescript
Response:
{
  "totalStaked": "0x...",  // 전체 스테이킹 금액 (Wei, Hex String)
  "totalValidators": 100,  // 전체 Validator 수
  "activeValidators": 95,  // 활성 Validator 수
  "pendingValidators": 5,  // 대기 중인 Validator 수
  "totalRewards": "0x...",  // 전체 지급된 보상 (Wei, Hex String)
  "averageAPY": "4.5"  // 평균 연간 수익률 (%)
}
```

### 7. 활성 Validator 목록

**GET /staking/validators**

```typescript
Query Parameters:
  - page: number (기본값: 1)
  - limit: number (기본값: 50)
  - status?: "active" | "pending" | "exiting" | "all"

Response:
{
  "total": 100,
  "page": 1,
  "limit": 50,
  "validators": [
    {
      "address": "0x...",
      "stakedAmount": "0x8ac7230489e80000",
      "status": "active",
      "totalRewards": "0x16345785d8a0000"
    },
    // ...
  ]
}
```

---

## 데이터 모델

### Validator Entity (Backend)

```typescript
// src/staking/entities/validator.entity.ts

export enum ValidatorStatus {
  Inactive = 'inactive',    // 비활성
  Pending = 'pending',      // 활성화 대기
  Active = 'active',        // 활성
  Exiting = 'exiting',      // 출금 대기 중
  Withdrawn = 'withdrawn'  // 출금 완료
}

export class Validator {
  /**
   * Validator 주소
   */
  address: Address;

  /**
   * 스테이킹 금액 (Wei)
   */
  stakedAmount: bigint;

  /**
   * 상태
   */
  status: ValidatorStatus;

  /**
   * 활성화된 블록 번호
   */
  activatedAt: number | null;

  /**
   * 출금 요청 블록 번호
   */
  exitRequestedAt: number | null;

  /**
   * 누적 보상 (Wei)
   */
  totalRewards: bigint;

  /**
   * 슬래싱된 금액 (Wei)
   */
  slashedAmount: bigint;

  /**
   * 등록 시간
   */
  registeredAt: Date;

  /**
   * 마지막 업데이트 시간
   */
  updatedAt: Date;
}
```

### Staking Transaction (DB 저장)

```typescript
// src/staking/entities/staking-transaction.entity.ts

export enum StakingTransactionType {
  Deposit = 'deposit',
  WithdrawalRequest = 'withdrawal_request',
  Withdrawal = 'withdrawal',
  Reward = 'reward',
  Slash = 'slash'
}

export class StakingTransaction {
  /**
   * 트랜잭션 해시
   */
  hash: string;

  /**
   * Validator 주소
   */
  validatorAddress: Address;

  /**
   * 트랜잭션 타입
   */
  type: StakingTransactionType;

  /**
   * 금액 (Wei)
   */
  amount: bigint;

  /**
   * 블록 번호
   */
  blockNumber: number;

  /**
   * 트랜잭션 인덱스
   */
  transactionIndex: number;

  /**
   * 생성 시간
   */
  timestamp: Date;
}
```

---

## 보상 시스템

### 보상 계산

#### 1. Proposer 보상
```
블록 생성 시:
- Base Reward: 2 DSTN (고정)
- Transaction Fees: 블록 내 트랜잭션 수수료의 일부
- 총 보상 = Base Reward + Transaction Fees
```

#### 2. Committee 보상
```
Attestation 제출 시:
- Base Reward Pool: 1 DSTN (고정)
- Committee 크기: 128명
- 각 Validator 보상 = Base Reward Pool / 128
- 총 보상 = 약 0.0078 DSTN per Attestation
```

#### 3. 보상 지급 프로세스

```typescript
// BlockProducer에서 블록 생성 후
async produceBlock() {
  // 1. 블록 생성
  const block = await this.blockService.createBlock(proposer);
  
  // 2. Proposer 보상 지급
  const proposerReward = PROPOSER_REWARD * WEI_PER_DSTN;
  await this.stakingService.rewardValidator(proposer, proposerReward);
  
  // 3. Committee 보상 지급
  const committeeRewardPerValidator = 
    (COMMITTEE_REWARD_POOL * WEI_PER_DSTN) / BigInt(committee.length);
  
  for (const validator of committee) {
    await this.stakingService.rewardValidator(
      validator, 
      committeeRewardPerValidator
    );
  }
}
```

### APY (연간 수익률) 계산

```
가정:
- 블록 생성 주기: 12초
- 하루 블록 수: 7,200 블록
- 연간 블록 수: 약 2,628,000 블록

Proposer 보상:
- Proposer 선택 확률 = 1 / 활성 Validator 수
- 연간 예상 Proposer 횟수 = 2,628,000 / 활성 Validator 수
- 연간 Proposer 보상 = (2,628,000 / 활성 Validator 수) * 2 DSTN

Committee 보상:
- Committee 선택 확률 = 128 / 활성 Validator 수
- 연간 예상 Attestation 횟수 = (2,628,000 * 128) / 활성 Validator 수
- 연간 Committee 보상 = (2,628,000 * 128 / 활성 Validator 수) * 0.0078 DSTN

총 연간 보상 = Proposer 보상 + Committee 보상
APY = (총 연간 보상 / 스테이킹 금액) * 100
```

---

## 슬래싱 (Slashing)

### 슬래싱 조건

#### 1. Double Vote (중복 투표)
```
같은 슬롯에 두 개의 서로 다른 Attestation 제출
→ 페널티: 스테이킹 금액의 1/32 (약 3.125%)
```

#### 2. Surround Vote (잘못된 체인 선택)
```
이전에 Finalized된 체인을 Surround하는 Attestation 제출
→ 페널티: 스테이킹 금액의 1/32 (약 3.125%)
```

#### 3. Offline (오프라인)
```
일정 기간 동안 Attestation 미제출
→ 페널티: 누락된 Attestation당 소액 페널티 (누적)
```

### 슬래싱 프로세스

```typescript
// ConsensusService에서 Attestation 검증 시
async validateAttestation(attestation: Attestation): Promise<boolean> {
  const validator = await this.getValidator(attestation.validator);
  
  // Double Vote 검증
  if (await this.hasDoubleVote(attestation)) {
    await this.stakingService.slashValidator(
      attestation.validator,
      validator.stakedAmount / 32n,  // 1/32 페널티
      "Double Vote"
    );
    return false;
  }
  
  // Surround Vote 검증
  if (await this.hasSurroundVote(attestation)) {
    await this.stakingService.slashValidator(
      attestation.validator,
      validator.stakedAmount / 32n,  // 1/32 페널티
      "Surround Vote"
    );
    return false;
  }
  
  return true;
}
```

---

## 출금 (Withdrawal)

### 출금 프로세스

#### 1. 출금 요청 (requestWithdrawal)
```
- Active → Exiting 상태 변경
- exitRequestedAt 블록 번호 기록
- WITHDRAWAL_DELAY (256 블록) 대기
```

#### 2. 출금 실행 (withdraw)
```
- Exiting 상태 확인
- WITHDRAWAL_DELAY 경과 확인
- 출금 가능 금액 계산: stakedAmount - slashedAmount
- DSTN 전송
- Withdrawn 상태로 변경
- Validator 목록에서 제거
```

### 출금 대기 시간

```
WITHDRAWAL_DELAY = 256 블록
블록 생성 주기 = 12초
출금 대기 시간 = 256 * 12초 = 약 51분
```

---

## 구현 단계

### Phase 1: 스마트 컨트랙트 구현
- [ ] `StakingContract.sol` 작성
- [ ] 컨트랙트 배포 스크립트 작성
- [ ] 컨트랙트 테스트 작성

### Phase 2: 백엔드 API 구현
- [ ] `StakingModule` 생성
- [ ] `StakingService` 구현
  - [ ] `deposit()`: 스테이킹 예치
  - [ ] `requestWithdrawal()`: 출금 요청
  - [ ] `withdraw()`: 출금 실행
  - [ ] `getValidator()`: Validator 정보 조회
  - [ ] `rewardValidator()`: 보상 지급
  - [ ] `slashValidator()`: 슬래싱
- [ ] `StakingController` 구현
  - [ ] `POST /staking/deposit`
  - [ ] `POST /staking/withdraw-request`
  - [ ] `POST /staking/withdraw`
  - [ ] `GET /staking/validator/:address`
  - [ ] `GET /staking/rewards/:address`
  - [ ] `GET /staking/stats`
  - [ ] `GET /staking/validators`

### Phase 3: ValidatorService 통합
- [ ] Validator Entity 확장 (stakedAmount 추가)
- [ ] ValidatorService 수정
  - [ ] Genesis Validator → 동적 Validator Registry
  - [ ] 스테이킹 가중치 기반 Proposer/Committee 선택
- [ ] Validator 활성화 로직 (Pending → Active)

### Phase 4: 보상 시스템 통합
- [ ] BlockProducer 수정
  - [ ] Proposer 보상 지급
  - [ ] Committee 보상 지급
- [ ] 보상 계산 로직 구현
- [ ] APY 계산 로직 구현

### Phase 5: 슬래싱 시스템 구현
- [ ] ConsensusService 수정
  - [ ] Double Vote 검증
  - [ ] Surround Vote 검증
  - [ ] Offline 감지
- [ ] 슬래싱 로직 구현

### Phase 6: 테스트 및 문서화
- [ ] 단위 테스트 작성
- [ ] E2E 테스트 작성
- [ ] API 문서 작성 (Swagger)
- [ ] 사용자 가이드 작성

---

## 참고 사항

### 이더리움과의 차이점

1. **최소 스테이킹 금액**: 32 DSTN (이더리움 32 ETH)
2. **출금 대기 시간**: 256 블록 (약 51분, 이더리움 약 27시간)
3. **보상 구조**: 단순화 (Proposer 2 DSTN, Committee 1 DSTN)
4. **슬래싱**: 기본 구현 (이더리움은 더 복잡한 슬래싱 규칙)

### 보안 고려사항

1. **관리자 권한**: `admin` 주소는 멀티시그 또는 DAO로 관리
2. **슬래싱 검증**: Double Vote, Surround Vote는 ConsensusService에서 엄격히 검증
3. **출금 대기 시간**: 악의적 행동 후 즉시 탈출 방지
4. **최소 스테이킹 금액**: 네트워크 보안을 위한 장벽

### 확장 가능성

1. **Partial Withdrawal**: 보상만 인출, 32 DSTN 유지
2. **Validator Pool**: 여러 사용자가 자산을 모아 Validator 운영
3. **Delegation**: 스테이킹 위임 (나중에 고려)

---

## 결론

이더리움 PoS 기반 스테이킹 시스템을 구현하여:
- 사용자가 DSTN을 스테이킹하여 Validator가 될 수 있도록 함
- 블록 제안/검증에 대한 보상 지급
- 악의적 행동에 대한 슬래싱
- 안전한 출금 메커니즘 제공

이 설계를 기반으로 단계적으로 구현하면 됩니다.

