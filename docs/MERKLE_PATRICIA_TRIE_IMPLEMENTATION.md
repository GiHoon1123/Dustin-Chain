# Merkle Patricia Trie 구현 및 StateManager 설계

> 이더리움 표준 Merkle Patricia Trie 구현과 State 관리 구조 개선에 대한 논의

---

## 🎯 현재 상황

### ✅ 완료된 작업 (2025-10-15)

#### 1. Merkle Patricia Trie 구현 완료
- **State Root**: 계정 상태를 Merkle Patricia Trie로 관리
- **Transactions Root**: 트랜잭션을 Merkle Patricia Trie로 관리  
- **Block Hash**: RLP 인코딩으로 블록 해시 계산
- **RLP 유틸리티**: CryptoService에 RLP 인코딩/디코딩 메서드 추가
- **이더리움 상수**: EMPTY_ROOT, EMPTY_HASH 추가

#### 2. 커밋 완료
```
ef5e970 - feat: Add Ethereum packages for Merkle Patricia Trie and RLP encoding
cbd31cb - feat: Add RLP encoding utilities to CryptoService  
18f88a6 - feat: Add Ethereum standard constants for empty roots
644611e - feat: Implement Ethereum-standard Merkle Patricia Trie for state and transactions
```

#### 3. 테스트 성공
- Genesis Block 생성: State Root `0x4d15c5e871feb50228ed51274eccf7147df9cf6fbda51c71f2fb3b2ba2080714`
- 블록 자동 생성: 12초마다 정상 동작
- Merkle Patricia Trie로 State Root 계산 성공

---

## 🔍 발견된 구조적 문제

### 문제: 이중 State 구조

#### 현재 구현 (모순)
```typescript
// 평상시: 계정은 Map에 저장
class AccountMemoryRepository {
  private accounts: Map<Address, Account>;  // ← 진짜 데이터
}

// State Root 계산 시: 임시 Trie 생성
calculateStateRoot() {
  const trie = new Trie();  // ← 임시!
  const accounts = await getAllAccounts();  // Map에서 복사
  for (const account of accounts) {
    trie.put(key, value);  // 임시 Trie에 넣음
  }
  return trie.root();  // ← 계산 후 버려짐!
}
```

#### 문제점
- **State**: Map에 저장 (객체)
- **State Root**: 임시 Trie로 계산 (버려짐)
- **성능**: 매번 O(n) 복사 비용 (n = 계정 수)
- **개념**: State와 State Root가 분리됨

---

## ✅ 이더리움의 올바른 구조

### 핵심 개념: Global State

```typescript
// 이더리움 방식
class StateManager {
  private state: Trie;  // ← State 자체가 Trie!
  
  // 계정 조회
  async getAccount(address) {
    return await this.state.get(keccak256(address));
  }
  
  // 계정 저장  
  async setAccount(address, account) {
    await this.state.put(keccak256(address), rlp.encode(account));
  }
  
  // State Root
  getStateRoot() {
    return this.state.root();  // ← 즉시 계산!
  }
  
  // 트랜잭션 실행
  async executeTransaction(tx) {
    // State Trie 직접 수정
    await this.state.put(from, newBalance);
    await this.state.put(to, newBalance);
    // → State Root 자동 업데이트!
  }
}
```

### 장점
- **일관성**: State = Trie (하나로 통일)
- **성능**: O(1) State Root 계산 (복사 없음)
- **개념**: 이더리움과 동일한 구조
- **확장성**: Merkle Proof 지원

---

## 📊 Transactions Root vs State Root

### Transactions Root: 임시 계산이 정석 ✅
```typescript
calculateTransactionsRoot(transactions) {
  const trie = new Trie();  // ← 임시 OK!
  for (let i = 0; i < transactions.length; i++) {
    trie.put(rlp(i), rlp(transactions[i]));
  }
  return trie.root();  // ← 버려도 OK!
}
```

**이유:**
- 블록마다 트랜잭션이 다름 (독립적)
- 한 번 계산하면 끝
- 트랜잭션은 블록에 영구 저장됨
- 이더리움도 동일하게 함

### State Root: 임시 계산이 비정석 ❌
```typescript
calculateStateRoot() {
  const trie = new Trie();  // ← 임시 BAD!
  // 매번 전체 계정 복사...
  return trie.root();  // ← 버려짐!
}
```

**문제:**
- State는 누적적 (이전 State 기반)
- 매번 O(n) 복사 비용
- State와 State Root가 분리됨

---

## 🚀 다음 단계: StateManager 구현

### Phase 1: In-Memory StateManager (개념 확립)
```typescript
class StateManager {
  private state: Trie;  // 메모리
  
  constructor() {
    this.state = new Trie();
  }
  
  // 기본 기능
  async getAccount(address: Address): Promise<Account | null>
  async setAccount(address: Address, account: Account): Promise<void>
  getStateRoot(): Hash
  async executeTransaction(tx: Transaction): Promise<void>
}
```

### Phase 2: LevelDB 영속성 (프로덕션 준비)
```typescript
import { Level } from 'level';

class StateManager {
  private db: Level;
  private state: Trie;
  
  constructor() {
    this.db = new Level('./data/state');
    this.state = new Trie({ db: this.db });  // ← 이것만 추가!
  }
  
  // 코드 변경 없음! 자동으로 디스크 사용!
}
```

### 장점
- **영속성**: AWS 재시작해도 State 유지
- **메모리 효율**: 계정 수십억 개도 처리 가능
- **이더리움 표준**: Geth와 동일한 구조

---

## 📋 구현 계획

### 우선순위 1: StateManager 구조 설계
1. **StateManager 클래스** 생성
2. **Repository 패턴** 적용 (In-Memory → LevelDB 교체 가능)
3. **AccountService 리팩토링** (StateManager 사용)
4. **BlockService 리팩토링** (StateManager에서 State Root 가져옴)

### 우선순위 2: 영속성 추가
1. **LevelDB 설치** (`npm install level`)
2. **StateRepository 구현** (LevelDB 백엔드)
3. **환경별 설정** (dev: In-Memory, prod: LevelDB)

### 우선순위 3: 최적화
1. **캐시 레이어** 추가
2. **Pruning** (오래된 State 정리)
3. **Snapshot** (백업)

---

## 🎯 핵심 개념 정리

### 이더리움 블록체인의 본질
```
블록체인 = State의 변화 과정

Block 0: State Root = 0xabc..., State = { 0x111: 1000, 0x222: 500 }
Block 1: State Root = 0xdef..., State = { 0x111: 900, 0x222: 600 }  ← 변경됨!
Block 2: State Root = 0x456..., State = { 0x111: 800, 0x222: 700 }  ← 또 변경됨!

각 블록 = State의 스냅샷
트랜잭션 = State 변경 명령
"지갑 잔액" = State에 기록된 값 (실제로는 존재하지 않음)
```

### StateManager의 역할
- **전역 상태 관리**: 모든 계정 정보를 하나의 Trie에 저장
- **트랜잭션 실행**: State를 직접 수정하는 유일한 방법
- **State Root 계산**: Trie.root()로 즉시 계산
- **영속성**: 디스크에 저장하여 재시작 대응

---

## 📝 참고사항

### 현재 동작하는 기능들
- ✅ Genesis Block 생성 및 자동 블록 생성
- ✅ 트랜잭션 서명 및 전송
- ✅ Merkle Patricia Trie State Root 계산
- ✅ RLP 인코딩 및 이더리움 표준 준수

### 배포 준비 상태
- ✅ 핵심 기능 모두 동작
- ⚠️ StateManager 구현 필요 (구조 개선)
- ⚠️ 영속성 추가 필요 (LevelDB)

### 다음 작업 세션에서 할 일
1. **StateManager 클래스 구현**
2. **AccountService 리팩토링** 
3. **Repository 패턴 적용**
4. **LevelDB 추가** (선택)

---

## 🔗 관련 파일들

### 수정된 파일
- `src/block/block.service.ts` - Merkle Patricia Trie 구현
- `src/common/crypto/crypto.service.ts` - RLP 유틸리티 추가
- `src/common/constants/blockchain.constants.ts` - 이더리움 상수 추가

### 새로 만들어야 할 파일
- `src/state/state.manager.ts` - 전역 상태 관리
- `src/state/state.repository.interface.ts` - Repository 인터페이스
- `src/state/in-memory-state.repository.ts` - In-Memory 구현
- `src/state/leveldb-state.repository.ts` - LevelDB 구현

### 관련 문서
- `docs/BLOCK_IMPROVEMENTS.md` - 블록 모듈 개선사항
- `TODO.md` - 전체 개발 계획

---

*마지막 업데이트: 2025-10-15*
*다음 작업: StateManager 구현 및 Repository 패턴 적용*
