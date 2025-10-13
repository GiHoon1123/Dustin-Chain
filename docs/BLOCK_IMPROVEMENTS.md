# Block 모듈 개선사항

> 현재 간단하게만 구현되어 있고, 완전한 이더리움 구현을 위해 개선이 필요한 항목들

---

## 🔶 간단 구현 (개선 필요)

### 1. State Root 계산

**현재 구현:**

```typescript
// src/block/block.service.ts
private async calculateStateRoot(): Promise<Hash> {
  const accounts = await this.accountService.getAllAccounts();
  const stateData = accounts.map((acc) => ({
    address: acc.address,
    balance: acc.balance.toString(),
    nonce: acc.nonce,
  }));

  // 단순 JSON 해시
  return this.cryptoService.hashUtf8(JSON.stringify(stateData));
}
```

**문제점:**

- ❌ Merkle Patricia Trie 미구현
- ❌ Merkle Proof 불가능 (Light Client 지원 안됨)
- ❌ 계정 순서에 의존적
- ❌ 효율성 낮음

**완전 구현 (이더리움):**

```typescript
private async calculateStateRoot(): Promise<Hash> {
  const trie = new MerklePatriciaTrie();

  const accounts = await this.accountService.getAllAccounts();
  for (const account of accounts) {
    const key = keccak256(account.address);
    const value = rlp.encode([
      account.nonce,
      account.balance,
      EMPTY_ROOT,  // storageRoot
      EMPTY_HASH   // codeHash
    ]);
    await trie.put(key, value);
  }

  return trie.root();
}
```

**필요 작업:**

- [ ] Merkle Patricia Trie 라이브러리 추가 (`merkle-patricia-tree`)
- [ ] State Trie 구현
- [ ] Merkle Proof 생성/검증 기능
- [ ] Light Client 지원

**우선순위:** 중간 (Phase 4-5)

---

### 2. Transactions Root 계산

**현재 구현:**

```typescript
// src/block/block.service.ts
private calculateTransactionsRoot(transactions: Transaction[]): Hash {
  if (transactions.length === 0) {
    return '0x' + '0'.repeat(64);
  }

  // 트랜잭션 해시들을 JSON으로 해시
  const txHashes = transactions.map((tx) => tx.hash);
  return this.cryptoService.hashUtf8(JSON.stringify(txHashes));
}
```

**문제점:**

- ❌ Merkle Tree 미구현
- ❌ Merkle Proof 불가능
- ❌ 트랜잭션 존재 증명 안됨
- ❌ 트랜잭션 순서 변경 시 해시 변경

**완전 구현 (이더리움):**

```typescript
private calculateTransactionsRoot(transactions: Transaction[]): Hash {
  if (transactions.length === 0) {
    return EMPTY_ROOT;
  }

  const leaves = transactions.map(tx => keccak256(rlp.encode(tx)));
  const tree = new MerkleTree(leaves);

  return tree.root();
}
```

**필요 작업:**

- [ ] Merkle Tree 구현 (`merkletreejs` 라이브러리)
- [ ] Transaction RLP 인코딩
- [ ] Merkle Proof 생성/검증
- [ ] `getTransactionProof(txHash)` API

**우선순위:** 중간 (Phase 4-5)

---

### 3. Block Hash 계산

**현재 구현:**

```typescript
// src/block/block.service.ts
private calculateBlockHash(
  number: number,
  parentHash: Hash,
  timestamp: number,
  proposer: Address,
  transactionsRoot: Hash,
  stateRoot: Hash,
): Hash {
  const headerData = {
    number,
    parentHash,
    timestamp,
    proposer,
    transactionsRoot,
    stateRoot,
  };

  // JSON 직렬화 후 해시
  return this.cryptoService.hashUtf8(JSON.stringify(headerData));
}
```

**문제점:**

- ❌ RLP 인코딩 미구현
- ❌ 이더리움 노드와 호환 불가
- ❌ 필드 순서에 의존적
- ❌ 비효율적 (크기 큼)

**완전 구현 (이더리움):**

```typescript
private calculateBlockHash(header: BlockHeader): Hash {
  const encoded = rlp.encode([
    header.parentHash,
    header.unclesHash,        // 우리는 사용 안함
    header.proposer,
    header.stateRoot,
    header.transactionsRoot,
    header.receiptsRoot,      // 우리는 미구현
    header.logsBloom,         // 우리는 사용 안함
    header.difficulty,        // POS에서는 0
    header.number,
    header.gasLimit,          // 우리는 미구현
    header.gasUsed,           // 우리는 미구현
    header.timestamp,
    header.extraData,         // 추가 데이터
    header.mixHash,           // POS에서는 RANDAO
    header.nonce              // POW 유산, POS에서는 0
  ]);

  return keccak256(encoded);
}
```

**필요 작업:**

- [ ] RLP 라이브러리 추가 (`rlp`)
- [ ] Block Header 전체 필드 구현
- [ ] RLP 인코딩 적용
- [ ] 이더리움 표준 준수

**우선순위:** 낮음 (Phase 6+) - JSON도 동작하므로

---

### 4. Proposer 선택

**현재 구현:**

```typescript
// src/block/block.service.ts
private readonly GENESIS_PROPOSER: Address =
  '0x0000000000000000000000000000000000000001';

async createBlock(): Promise<Block> {
  // 고정된 proposer 사용
  const proposer = this.GENESIS_PROPOSER;
  // ...
}
```

**문제점:**

- ❌ 항상 같은 주소가 블록 생성
- ❌ 탈중앙화 안됨
- ❌ Validator 모듈 없음
- ❌ 무작위 선택 없음
- ❌ 스테이킹 가중치 없음

**완전 구현 (이더리움):**

```typescript
// validator/validator.service.ts
async selectProposer(slot: number): Promise<Address> {
  // 1. 활성 Validator 목록
  const validators = await this.getActiveValidators();

  // 2. RANDAO seed 생성
  const seed = await this.getRandaoSeed(slot);

  // 3. 스테이킹 가중치 기반 무작위 선택
  const weights = validators.map(v => v.stakedAmount);
  const index = this.weightedRandom(weights, seed);

  return validators[index].address;
}

// block/producer/block.producer.ts
private async produceBlock(): Promise<void> {
  const currentSlot = this.getCurrentSlot();

  // Validator 모듈에서 선택
  const proposer = await this.validatorService.selectProposer(currentSlot);

  await this.blockService.createBlock(proposer);
}
```

**필요 작업:**

- [ ] Validator 모듈 구현
- [ ] Staking 시스템
- [ ] RANDAO (난수 생성)
- [ ] Proposer 선택 알고리즘
- [ ] `BlockService.createBlock(proposer)` 파라미터 추가

**우선순위:** 높음 (Phase 3-4) - 핵심 기능!

---

## ❌ 미구현 (새로 만들어야 함)

### 5. 블록 검증 로직

**필요 기능:**

```typescript
// block/block.service.ts
async validateBlock(block: Block): Promise<boolean> {
  // 1. parentHash 연결 확인
  const parent = await this.getBlockByHash(block.parentHash);
  if (!parent || parent.number !== block.number - 1) {
    return false;
  }

  // 2. timestamp 순서 확인
  if (block.timestamp <= parent.timestamp) {
    return false;
  }

  // 3. State Root 검증
  const computedStateRoot = await this.calculateStateRoot();
  if (computedStateRoot !== block.stateRoot) {
    return false;
  }

  // 4. Transactions Root 검증
  const computedTxRoot = this.calculateTransactionsRoot(block.transactions);
  if (computedTxRoot !== block.transactionsRoot) {
    return false;
  }

  // 5. Proposer 권한 확인
  const expectedProposer = await this.validatorService.selectProposer(slot);
  if (block.proposer !== expectedProposer) {
    return false;
  }

  // 6. 모든 트랜잭션 검증
  for (const tx of block.transactions) {
    if (!await this.transactionService.validateTransaction(tx)) {
      return false;
    }
  }

  return true;
}
```

**우선순위:** 높음 (Phase 3)

---

### 6. Attestation (검증자 투표)

**필요 기능:**

```typescript
// consensus/consensus.service.ts
async collectAttestations(
  block: Block,
  committee: Address[]
): Promise<Attestation[]> {
  const attestations: Attestation[] = [];

  for (const validator of committee) {
    const attestation = await this.requestAttestation(validator, block);

    // 서명 검증
    if (this.verifyAttestationSignature(attestation)) {
      attestations.push(attestation);
    }
  }

  return attestations;
}

async finalizeBlock(block: Block, attestations: Attestation[]): Promise<void> {
  const requiredVotes = Math.floor(committee.length * 2 / 3);

  if (attestations.length >= requiredVotes) {
    block.status = 'finalized';
    await this.repository.save(block);
  }
}
```

**필요 작업:**

- [ ] Attestation Entity
- [ ] Committee 선택 로직
- [ ] Attestation 수집
- [ ] 서명 검증
- [ ] 2/3 투표 확인
- [ ] Block Finalization

**우선순위:** 중간 (Phase 4)

---

### 7. Receipts Root

**필요 기능:**

```typescript
// transaction/entities/receipt.entity.ts
export class TransactionReceipt {
  transactionHash: Hash;
  blockNumber: number;
  from: Address;
  to: Address;
  gasUsed: bigint;
  status: 'success' | 'failed';
  logs: Log[];           // 이벤트 로그
  contractAddress?: Address;  // 컨트랙트 배포 시
}

// block/block.service.ts
private calculateReceiptsRoot(receipts: TransactionReceipt[]): Hash {
  const leaves = receipts.map(r => keccak256(rlp.encode(r)));
  const tree = new MerkleTree(leaves);
  return tree.root();
}
```

**필요 작업:**

- [ ] TransactionReceipt Entity
- [ ] Receipt 생성 로직
- [ ] Receipts Root 계산
- [ ] Receipt 조회 API

**우선순위:** 낮음 (Phase 5+)

---

### 8. Fork Choice Rule

**필요 기능:**

```typescript
// consensus/fork-choice.service.ts
async selectCanonicalChain(): Promise<Block[]> {
  // LMD-GHOST (Latest Message Driven Greedy Heaviest Observed SubTree)

  // 1. 모든 포크 조회
  const forks = await this.getAllForks();

  // 2. 각 포크의 가중치 계산 (Attestation 기반)
  const weights = forks.map(fork => this.calculateWeight(fork));

  // 3. 가장 무거운 포크 선택
  const canonical = forks[weights.indexOf(Math.max(...weights))];

  return canonical;
}

async reorganize(newCanonicalChain: Block[]): Promise<void> {
  // 체인 재조직
  // 1. 현재 체인에서 새 체인으로 전환
  // 2. 상태 롤백 및 재적용
  // 3. Mempool 재구성
}
```

**필요 작업:**

- [ ] Fork 감지
- [ ] LMD-GHOST 구현
- [ ] 가중치 계산
- [ ] Reorganization 처리

**우선순위:** 낮음 (Phase 6+)

---

### 9. Gas 시스템

**필요 기능:**

```typescript
// common/constants/blockchain.constants.ts
export const GAS_LIMIT = 30_000_000; // 블록당 Gas 한도
export const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8; // EIP-1559

// transaction/entities/transaction.entity.ts
export class Transaction {
  gasLimit: bigint; // 최대 Gas
  gasPrice?: bigint; // Legacy
  maxFeePerGas?: bigint; // EIP-1559
  maxPriorityFeePerGas?: bigint; // EIP-1559
}

// block/entities/block.entity.ts
export class Block {
  gasLimit: bigint;
  gasUsed: bigint;
  baseFeePerGas: bigint; // EIP-1559
}
```

**필요 작업:**

- [ ] Gas 계산 로직
- [ ] EIP-1559 (Base Fee)
- [ ] Gas Limit 검증
- [ ] Fee 분배 (Proposer, Burn)

**우선순위:** 낮음 (Phase 6+) - 복잡함

---

### 10. Extra Data

**필요 기능:**

```typescript
// block/entities/block.entity.ts
export class Block {
  extraData: string;  // Proposer가 추가하는 데이터
}

// block/block.service.ts
async createBlock(proposer: Address, extraData?: string): Promise<Block> {
  const block = new Block(
    // ...
    extraData: extraData || '0x',
  );
}
```

**우선순위:** 낮음 (Phase 7+) - 선택사항

---

## 📋 개선 우선순위

### Phase 3 (높음 - 다음 작업)

- [x] Block 모듈 기본 구현
- [ ] **Validator 모듈** (Proposer 선택)
- [ ] **블록 검증 로직**
- [ ] Staking 시스템

### Phase 4 (중간)

- [ ] Attestation 시스템
- [ ] Merkle Patricia Trie (State Root)
- [ ] Merkle Tree (Transactions Root)
- [ ] RANDAO

### Phase 5 (낮음)

- [ ] RLP 인코딩
- [ ] Finality (Casper FFG)
- [ ] Receipts Root

### Phase 6+ (선택)

- [ ] Fork Choice Rule
- [ ] Gas 시스템
- [ ] Extra Data
- [ ] Full 이더리움 호환

---

## 🎯 현재 상태

**동작하는 기능:**

- ✅ Genesis Block 생성
- ✅ 12초마다 자동 블록 생성
- ✅ 트랜잭션 실행
- ✅ Block Reward 지급
- ✅ 블록 조회 API

**간단 구현 (동작은 하지만 완전하지 않음):**

- 🔶 State Root (JSON 해시)
- 🔶 Transactions Root (JSON 해시)
- 🔶 Block Hash (JSON 해시)
- 🔶 Proposer (고정)

**미구현:**

- ❌ Validator 선택
- ❌ 블록 검증
- ❌ Attestation
- ❌ Finality
- ❌ Fork Choice
- ❌ Gas 시스템

---

## 💡 결론

**현재는 MVP로 충분히 동작합니다!**

- 블록이 생성되고
- 트랜잭션이 실행되고
- 상태가 변경됩니다

**다음 단계:**

1. Validator 모듈 구현 (가장 중요!)
2. 블록 검증 로직 추가
3. 점진적으로 나머지 개선

**완전한 이더리움 구현은 장기 목표입니다!** 🚀
