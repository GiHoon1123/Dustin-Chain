# Dustin-Chain Ethereum 2.0 구현 TODO 리스트

## 📋 현재 진행 상황

### 완료된 작업들

#### 1단계: StateManager 기반 아키텍처 구축

- [x] **LevelDB 설치 및 설정**
  - `level` 패키지 설치
  - `@types/level` 타입 정의 설치
  - LevelDB 데이터베이스 초기화

- [x] **StateManager 클래스 구현 (캐시 + 저널링 + DB)**
  - LevelDB 기반 영구 저장소 구현
  - LRU 캐시 시스템 구현
  - 저널링 시스템으로 변경사항 추적
  - RLP 직렬화/역직렬화 구현
  - Ethereum 2.0 계정 구조 `[nonce, balance, storageRoot, codeHash]` 적용
  - 에포크 기반 체크포인트 시스템 구현 (32블록마다)

- [x] **StateModule을 글로벌 모듈로 설정**
  - `@Global()` 데코레이터 추가
  - StateManager 전역 제공으로 의존성 주입 간소화
  - CryptoService 중복 provider 제거
  - AppModule에 StateModule import 추가

- [x] **AccountService StateManager 연동**
  - StateManager 의존성 주입
  - 모든 계정 조회/수정 메서드를 StateManager 사용하도록 변경
  - `getOrCreateAccount`, `getAccount`, `getBalance`, `getNonce`, `addBalance`, `subtractBalance`, `incrementNonce`, `exists` 메서드 수정
  - AccountModule에서 StateManager 주입 설정
  - Genesis 계정 잔액 0 문제 해결

- [x] **StateManager LevelDB 오류 수정**
  - `getAccount()` 메서드에서 DB 상태 확인 후 접근
  - `this.db.status === 'open'` 체크 추가
  - `LEVEL_DATABASE_NOT_OPEN` 에러 처리 추가
  - 의존성 주입 순서 문제로 인한 DB 접근 오류 수정

### 🔄 현재 상태

- **AccountService**: StateManager 사용하여 정상 동작
- **StateManager**: DB 상태 확인 후 안전한 접근
- **LevelDB**: 오류 없이 정상 동작
- **Genesis 계정**: 정상적으로 잔액 보유 (50+ DSTN)
- **저널링 시스템**: 변경사항 추적 중 (아직 `commitBlock()` 호출 안됨)

---

## 🚀 다음 단계: BlockService StateManager 연동

### 📝 2단계: BlockService StateManager 연동 (진행 예정)

- [ ] **BlockService에 StateManager 의존성 주입**
  - BlockService 생성자에 StateManager 주입
  - BlockModule에서 StateManager 의존성 설정

- [ ] **BlockService Genesis Block 생성 시 StateManager.commitBlock() 호출**
  - Genesis Block 생성 후 저널의 변경사항을 LevelDB에 저장
  - Genesis 계정들의 잔액이 실제로 LevelDB에 영구 저장되도록 수정

- [ ] **BlockService 일반 블록 생성 시 StateManager 사용**
  - 블록 생성 시 `StateManager.startBlock()` 호출
  - 블록 완성 시 `StateManager.commitBlock()` 호출
  - 블록 롤백 시 `StateManager.rollbackBlock()` 호출

- [ ] **BlockService stateRoot 계산을 StateManager 기반으로 수정**
  - 현재 임시 Trie 대신 StateManager의 상태를 기반으로 stateRoot 계산
  - Ethereum 2.0 표준에 맞는 상태 루트 계산

### 📝 3단계: 나머지 서비스들 StateManager 연동

- [ ] **TransactionService의 계정 조회 로직 수정**
  - TransactionService에서 StateManager 사용하도록 수정
  - 트랜잭션 실행 시 계정 상태 변경을 StateManager를 통해 처리

- [ ] **모든 서비스에서 getOrCreateAccount → getAccount로 변경**
  - Ethereum 2.0 표준에 맞게 계정이 없으면 null 반환
  - 명시적인 계정 생성만 허용

- [ ] **AccountRepository를 StateManager 기반으로 변경**
  - 기존 메모리 기반 Repository를 StateManager 기반으로 교체
  - 또는 Repository를 완전히 제거하고 StateManager 직접 사용

### 📝 4단계: 정리 및 최적화

- [ ] **기존 메모리 기반 저장소 제거 및 정리**
  - AccountMemoryRepository 제거
  - BlockMemoryRepository를 StateManager 기반으로 교체
  - 불필요한 메모리 기반 저장소 정리

- [ ] **StateManager 성능 최적화**
  - 캐시 크기 조정
  - 배치 처리 최적화
  - 메모리 사용량 모니터링

- [ ] **에포크 체크포인트 시스템 완성**
  - 체크포인트 복구 로직 테스트
  - 서버 재시작 시 체크포인트에서 복구 확인

---

## 🎯 최종 목표

### Ethereum 2.0 완전 구현

- **풀 노드 아키텍처**: stateRoot만 블록체인에 저장, 실제 데이터는 LevelDB에 저장
- **저널링 시스템**: 블록 단위로 상태 변경사항 추적 및 롤백 지원
- **RLP 직렬화**: Ethereum 표준에 맞는 데이터 직렬화
- **에포크 체크포인트**: 32블록마다 체크포인트 저장으로 빠른 복구
- **LevelDB 영구 저장**: 서버 재시작 후에도 상태 유지

### 현재 문제점

- **저널의 변경사항이 LevelDB에 저장되지 않음**: `commitBlock()` 호출 필요
- **BlockService가 StateManager를 사용하지 않음**: 블록 생성 시 상태 관리 분리
- **stateRoot 계산이 임시 Trie 사용**: StateManager 기반으로 변경 필요

---

## 📊 진행률

- **1단계 (StateManager 기반 아키텍처)**: 100% 완료
- **2단계 (BlockService 연동)**: 0% (다음 작업)
- **3단계 (나머지 서비스 연동)**: 0%
- **4단계 (정리 및 최적화)**: 0%

**전체 진행률: 약 25%**

---

## 🔧 기술 스택

- **NestJS**: 백엔드 프레임워크
- **LevelDB**: 영구 저장소
- **RLP**: Ethereum 표준 직렬화
- **Keccak-256**: 해싱 알고리즘
- **Merkle Patricia Trie**: 상태 루트 계산
- **TypeScript**: 타입 안전성

---

_마지막 업데이트: 2025-10-15_
