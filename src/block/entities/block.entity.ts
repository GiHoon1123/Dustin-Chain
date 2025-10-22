import { Address, Hash } from '../../common/types/common.types';
import { Transaction } from '../../transaction/entities/transaction.entity';

/**
 * Block Header (Ethereum Geth 방식)
 *
 * 헤더만 별도로 저장/조회:
 * - 크기 작음 (~200 bytes)
 * - 자주 조회됨
 * - 캐싱 효율적
 */
export interface BlockHeader {
  number: number;
  hash: Hash;
  parentHash: Hash;
  timestamp: number;
  proposer: Address;
  stateRoot: Hash;
  transactionsRoot: Hash;
  transactionCount: number;
}

/**
 * Block Body (Ethereum Geth 방식)
 *
 * 바디는 필요할 때만 조회:
 * - 크기 큼 (트랜잭션 전체)
 * - 가끔 조회됨
 * - 캐싱 안 함 (디스크 직접)
 */
export interface BlockBody {
  transactions: Transaction[];
}

/**
 * Block Entity
 *
 * 이더리움 블록:
 * - Header: 블록 메타데이터
 * - Body: 트랜잭션 리스트
 *
 * 블록체인:
 * - 블록들이 parentHash로 연결된 체인
 * - Genesis Block부터 시작 (parentHash = 0x0)
 * - 불변성: 한번 생성되면 수정 불가
 */
export class Block {
  /**
   * 블록 번호
   *
   * 이더리움:
   * - Genesis Block: 0
   * - 순차적으로 증가
   * - 현재 블록 높이 = 최신 블록 번호
   */
  number: number;

  /**
   * 블록 해시 (고유 식별자)
   *
   * 이더리움:
   * - Keccak-256(RLP(header))
   * - Header 전체를 해시
   *
   * 우리:
   * - 간단하게 주요 필드들을 JSON으로 해시
   * - number, parentHash, timestamp, proposer, transactionsRoot
   */
  hash: Hash;

  /**
   * 이전 블록 해시
   *
   * 이더리움:
   * - 블록체인 연결의 핵심
   * - parentHash가 이전 블록의 hash와 일치해야 함
   * - Genesis Block: 0x0000...0000
   *
   * 검증:
   * - block[n].parentHash === block[n-1].hash
   */
  parentHash: Hash;

  /**
   * 블록 생성 시간 (Unix timestamp, milliseconds)
   *
   * 이더리움:
   * - 12초마다 블록 생성 (Slot 시스템)
   * - timestamp는 슬롯 시작 시간과 일치
   *
   * 검증:
   * - timestamp > parentBlock.timestamp
   */
  timestamp: number;

  /**
   * 블록 생성자 주소 (Proposer)
   *
   * 이더리움 POS:
   * - 각 슬롯마다 선택된 Validator
   * - 선택 알고리즘: 스테이킹 가중치 기반
   *
   * 우리 (현재):
   * - 임시로 고정된 주소 사용
   * - Validator 모듈 만들면 실제 선택 로직 구현
   *
   * 보상:
   * - Proposer는 BLOCK_REWARD 받음
   */
  proposer: Address;

  /**
   * 트랜잭션 리스트
   *
   * 이더리움:
   * - 블록에 포함된 모든 트랜잭션 전체 데이터
   * - from, to, value, nonce, v, r, s, data 모두 포함
   * - 빈 블록 가능 (트랜잭션 없어도 블록 생성)
   *
   * 우리:
   * - Transaction[] 전체 객체 저장
   * - Mempool에서 pending 트랜잭션 가져와서 포함
   */
  transactions: Transaction[];

  /**
   * 상태 루트 (State Root)
   *
   * 이더리움:
   * - 모든 계정 상태의 Merkle Patricia Trie 루트 해시
   * - 전체 상태를 하나의 해시로 표현
   *
   * 우리 (현재):
   * - 간단하게 계산 (나중에 Merkle Tree 추가)
   * - 일단 모든 계정 정보를 해시
   */
  stateRoot: Hash;

  /**
   * 트랜잭션 루트 (Transactions Root)
   *
   * 이더리움:
   * - 트랜잭션들의 Merkle Tree 루트
   * - Header에 포함
   *
   * 우리 (현재):
   * - 트랜잭션 해시들을 모아서 해시
   * - 나중에 Merkle Tree 추가
   */
  transactionsRoot: Hash;

  constructor(
    number: number,
    parentHash: Hash,
    timestamp: number,
    proposer: Address,
    transactions: Transaction[],
    stateRoot: Hash,
    transactionsRoot: Hash,
    hash: Hash,
  ) {
    this.number = number;
    this.parentHash = parentHash;
    this.timestamp = timestamp;
    this.proposer = proposer;
    this.transactions = transactions;
    this.stateRoot = stateRoot;
    this.transactionsRoot = transactionsRoot;
    this.hash = hash;
  }

  /**
   * 트랜잭션 개수
   */
  getTransactionCount(): number {
    return this.transactions.length;
  }

  /**
   * Genesis Block 여부
   */
  isGenesis(): boolean {
    return this.number === 0;
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      number: this.number,
      hash: this.hash,
      parentHash: this.parentHash,
      timestamp: this.timestamp,
      proposer: this.proposer,
      transactionCount: this.transactions.length,
      transactions: this.transactions.map((tx) => tx.toJSON()),
      stateRoot: this.stateRoot,
      transactionsRoot: this.transactionsRoot,
    };
  }

  /**
   * Header만 반환 (Ethereum Geth 방식)
   *
   * 용도:
   * - 헤더 캐싱
   * - 헤더만 필요한 조회 (블록 번호, 해시 등)
   * - LevelDB 저장
   */
  getHeader(): BlockHeader {
    return {
      number: this.number,
      hash: this.hash,
      parentHash: this.parentHash,
      timestamp: this.timestamp,
      proposer: this.proposer,
      transactionCount: this.transactions.length,
      stateRoot: this.stateRoot,
      transactionsRoot: this.transactionsRoot,
    };
  }

  /**
   * Body만 반환 (Ethereum Geth 방식)
   *
   * 용도:
   * - 트랜잭션 전체 조회 시
   * - LevelDB 저장 (헤더와 분리)
   */
  getBody(): BlockBody {
    return {
      transactions: this.transactions,
    };
  }

  /**
   * Header + Body로 Block 재구성 (Ethereum Geth 방식)
   *
   * LevelDB에서 조회 후 Block 객체 생성
   */
  static fromHeaderAndBody(header: BlockHeader, body: BlockBody): Block {
    return new Block(
      header.number,
      header.parentHash,
      header.timestamp,
      header.proposer,
      body.transactions,
      header.stateRoot,
      header.transactionsRoot,
      header.hash,
    );
  }
}
