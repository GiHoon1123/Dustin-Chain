import { Address, Hash } from '../../common/types/common.types';

/**
 * Transaction Receipt Entity
 *
 * 이더리움 Receipt:
 * - 트랜잭션 실행 결과를 기록
 * - 블록에 포함되어 저장됨
 * - Receipt Trie로 구성 (receiptsRoot)
 *
 * Receipt의 용도:
 * - 트랜잭션 실행 결과 확인
 * - 이벤트 로그 조회
 * - Gas 사용량 추적
 * - Light Client가 실행 결과 검증
 */
export class TransactionReceipt {
  /**
   * 트랜잭션 해시
   *
   * 이더리움:
   * - Receipt와 Transaction을 연결하는 키
   */
  transactionHash: Hash;

  /**
   * 트랜잭션 인덱스 (블록 내 순서)
   *
   * 이더리움:
   * - 블록 내에서 트랜잭션의 위치
   * - 0부터 시작
   */
  transactionIndex: number;

  /**
   * 블록 해시
   *
   * 이더리움:
   * - Receipt가 포함된 블록
   */
  blockHash: Hash;

  /**
   * 블록 번호
   *
   * 이더리움:
   * - Receipt가 포함된 블록 번호
   */
  blockNumber: number;

  /**
   * 발신자 주소
   *
   * 이더리움:
   * - 트랜잭션 발신자
   */
  from: Address;

  /**
   * 수신자 주소
   *
   * 이더리움:
   * - 트랜잭션 수신자
   * - Contract 생성 시 null
   */
  to: Address | null;

  /**
   * 실행 상태
   *
   * 이더리움:
   * - 1: 성공
   * - 0: 실패 (revert)
   *
   * EIP-658 이전:
   * - root: Post-transaction state root
   *
   * EIP-658 이후:
   * - status: 1 or 0
   */
  status: 1 | 0;

  /**
   * Gas 사용량
   *
   * 이더리움:
   * - 트랜잭션 실행에 사용된 Gas
   * - 누적 Gas 사용량 (블록 내)
   */
  gasUsed: bigint;

  /**
   * 누적 Gas 사용량
   *
   * 이더리움:
   * - 블록 내에서 이 트랜잭션까지의 총 Gas 사용량
   */
  cumulativeGasUsed: bigint;

  /**
   * Contract 주소
   *
   * 이더리움:
   * - Contract 생성 시 생성된 Contract 주소
   * - 일반 송금 시 null
   *
   * 우리:
   * - Contract 미지원이므로 항상 null
   */
  contractAddress: Address | null;

  /**
   * 이벤트 로그
   *
   * 이더리움:
   * - Contract에서 발생한 이벤트
   * - [address, topics[], data]
   *
   * 우리:
   * - Contract 미지원이므로 빈 배열
   */
  logs: Log[];

  /**
   * Logs Bloom Filter
   *
   * 이더리움:
   * - 로그 검색 최적화를 위한 Bloom Filter
   * - 256 bytes
   *
   * 우리:
   * - 로그가 없으므로 빈 문자열
   */
  logsBloom: string;

  constructor(
    transactionHash: Hash,
    transactionIndex: number,
    blockHash: Hash,
    blockNumber: number,
    from: Address,
    to: Address | null,
    status: 1 | 0,
    gasUsed: bigint,
    cumulativeGasUsed: bigint,
  ) {
    this.transactionHash = transactionHash;
    this.transactionIndex = transactionIndex;
    this.blockHash = blockHash;
    this.blockNumber = blockNumber;
    this.from = from;
    this.to = to;
    this.status = status;
    this.gasUsed = gasUsed;
    this.cumulativeGasUsed = cumulativeGasUsed;
    this.contractAddress = null;
    this.logs = [];
    this.logsBloom = '0x' + '0'.repeat(512); // 256 bytes = 512 hex chars
  }

  /**
   * JSON 직렬화 (Ethereum JSON-RPC 표준)
   *
   * 이더리움 표준:
   * - transactionIndex, blockNumber, status: Hex String
   * - gasUsed, cumulativeGasUsed: Hex String
   */
  toJSON() {
    return {
      transactionHash: this.transactionHash,
      transactionIndex: `0x${this.transactionIndex.toString(16)}`, // ✅ Hex String
      blockHash: this.blockHash,
      blockNumber: `0x${this.blockNumber.toString(16)}`, // ✅ Hex String
      from: this.from,
      to: this.to,
      status: `0x${this.status.toString(16)}`, // ✅ Hex String (0x0 or 0x1)
      gasUsed: `0x${this.gasUsed.toString(16)}`, // ✅ Hex String
      cumulativeGasUsed: `0x${this.cumulativeGasUsed.toString(16)}`, // ✅ Hex String
      contractAddress: this.contractAddress,
      logs: this.logs,
      logsBloom: this.logsBloom,
    };
  }
}

/**
 * Event Log
 *
 * 이더리움:
 * - Contract에서 발생한 이벤트
 * - indexed 파라미터는 topics에 저장
 * - non-indexed 파라미터는 data에 저장
 */
export interface Log {
  /**
   * 로그를 발생시킨 Contract 주소
   */
  address: Address;

  /**
   * 로그 토픽 (indexed 파라미터)
   *
   * 이더리움:
   * - topics[0]: 이벤트 시그니처 해시 (keccak256("Transfer(address,address,uint256)"))
   * - topics[1..3]: indexed 파라미터 (최대 3개)
   */
  topics: Hash[];

  /**
   * 로그 데이터 (non-indexed 파라미터)
   *
   * 이더리움:
   * - ABI 인코딩된 데이터
   */
  data: string;

  /**
   * 블록 번호
   */
  blockNumber: number;

  /**
   * 트랜잭션 해시
   */
  transactionHash: Hash;

  /**
   * 트랜잭션 인덱스
   */
  transactionIndex: number;

  /**
   * 블록 해시
   */
  blockHash: Hash;

  /**
   * 로그 인덱스 (블록 내)
   */
  logIndex: number;

  /**
   * 로그가 제거되었는지 여부
   *
   * 이더리움:
   * - Chain reorganization 시 true
   */
  removed: boolean;
}
