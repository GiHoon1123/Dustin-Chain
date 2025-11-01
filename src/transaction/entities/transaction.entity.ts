import { Signature } from '../../common/crypto/crypto.types';
import { Address, Hash } from '../../common/types/common.types';

/**
 * Transaction Entity
 *
 * 이더리움 트랜잭션:
 * - EOA(계정)에서 발생하는 상태 변경 요청
 * - 서명으로 인증됨 (개인키 보유 증명)
 * - 블록에 포함되어 실행됨
 *
 * 트랜잭션 생명주기:
 * 1. 생성 & 서명 (클라이언트)
 * 2. 제출 & 검증 (노드)
 * 3. Mempool 대기 (pending)
 * 4. 블록 포함 (confirmed)
 */
export class Transaction {
  /**
   * 트랜잭션 해시 (고유 식별자)
   *
   * 이더리움:
   * - Keccak-256(RLP(tx))
   * - 서명 포함된 전체 트랜잭션을 해시
   *
   * 용도:
   * - 트랜잭션 추적
   * - 중복 방지
   * - 영수증 조회
   */
  hash: Hash;

  /**
   * 발신자 주소
   *
   * 이더리움:
   * - 서명으로부터 복구됨 (ecrecover)
   * - 트랜잭션에 명시적으로 포함 안됨 (서명으로 증명)
   *
   * 우리:
   * - 편의상 포함 (검증 시 서명과 일치하는지 확인)
   */
  from: Address;

  /**
   * 수신자 주소
   *
   * 이더리움:
   * - EOA: 일반 계정 (송금)
   * - Contract: 컨트랙트 호출
   * - null: 컨트랙트 배포
   *
   * EVM 통합 후:
   * - null인 경우 컨트랙트 배포 트랜잭션
   * - 주소가 있는 경우 일반 송금 또는 컨트랙트 호출
   */
  to: Address | null;

  /**
   * 송금 금액 (Wei 단위)
   *
   * 이더리움:
   * - 1 ETH = 10^18 Wei
   * - BigInt로 처리
   *
   * 우리:
   * - 1 DSTN = 10^18 Wei
   */
  value: bigint;

  /**
   * Nonce (발신자 계정 기준)
   *
   * 이더리움:
   * - 발신자가 보낸 트랜잭션 순서 번호
   * - 리플레이 공격 방지
   * - 순서 보장
   *
   * 검증:
   * - tx.nonce === account.nonce 이어야 함
   * - 블록 포함 후 account.nonce++
   */
  nonce: number;

  /**
   * ECDSA 서명 (v, r, s)
   *
   * 이더리움:
   * - 개인키 소유 증명
   * - EIP-155 (Replay Attack 방지)
   * - v = chainId * 2 + 35 + {0,1}
   */
  v: number;
  r: string;
  s: string;

  /**
   * 트랜잭션 상태
   *
   * pending: Mempool 대기 중
   * confirmed: 블록에 포함됨
   * failed: 실행 실패
   */
  status: 'pending' | 'confirmed' | 'failed';

  /**
   * 블록 번호 (블록에 포함된 경우)
   */
  blockNumber?: number;

  /**
   * 생성 시간
   */
  timestamp: Date;

  /**
   * 트랜잭션 데이터 (컨트랙트 배포/호출용 바이트코드)
   *
   * 이더리움:
   * - 빈 문자열: 일반 송금 트랜잭션
   * - 바이트코드: 컨트랙트 배포 또는 컨트랙트 함수 호출 데이터
   *
   * 저장 형식:
   * - 내부적으로 Buffer 또는 Hex String으로 처리
   * - JSON 직렬화 시 "0x" 접두사가 붙은 Hex String
   */
  data: string;

  /**
   * Gas 가격 (Wei 단위)
   *
   * 이더리움:
   * - 트랜잭션 실행 시 사용되는 가스의 단가
   * - 채굴자가 받는 수수료 = gasUsed * gasPrice
   * - 네트워크 혼잡도에 따라 조정됨
   *
   * 기본값:
   * - 1 Gwei = 10^9 Wei (일반적인 가스 가격)
   */
  gasPrice: bigint;

  /**
   * Gas 한도 (최대 가스 사용량)
   *
   * 이더리움:
   * - 트랜잭션 실행 시 최대로 사용할 수 있는 가스량
   * - gasUsed <= gasLimit 이어야 함
   * - 부족하면 Out of Gas 에러 발생
   *
   * 기본값:
   * - 21000: 일반 송금 트랜잭션의 기본 가스
   * - 컨트랙트 배포/호출 시 더 많은 가스 필요
   */
  gasLimit: bigint;

  constructor(
    from: Address,
    to: Address | null,
    value: bigint,
    nonce: number,
    signature: Signature,
    hash: Hash,
    data: string = '',
    gasPrice: bigint = BigInt('1000000000'), // 1 Gwei = 10^9 Wei
    gasLimit: bigint = BigInt(21000), // 기본 전송 트랜잭션 가스
  ) {
    this.from = from;
    this.to = to;
    this.value = value;
    this.nonce = nonce;
    this.v = signature.v;
    this.r = signature.r;
    this.s = signature.s;
    this.hash = hash;
    this.data = data;
    this.gasPrice = gasPrice;
    this.gasLimit = gasLimit;
    this.status = 'pending';
    this.timestamp = new Date();
  }

  /**
   * 블록에 포함되었음을 표시
   */
  confirm(blockNumber: number): void {
    this.status = 'confirmed';
    this.blockNumber = blockNumber;
  }

  /**
   * 실행 실패 표시
   */
  fail(): void {
    this.status = 'failed';
  }

  /**
   * 서명 객체 반환
   */
  getSignature(): Signature {
    return {
      v: this.v,
      r: this.r,
      s: this.s,
    };
  }

  /**
   * JSON 직렬화 (Ethereum JSON-RPC 표준)
   *
   * 이더리움 표준:
   * - value: Hex String (0x 접두사 포함)
   * - nonce: Hex String (0x 접두사 포함)
   * - v: Hex String (0x 접두사 포함)
   * - blockNumber: Hex String (0x 접두사 포함)
   * - data: Hex String (0x 접두사 포함, "0x"로 시작)
   * - gasPrice: Hex String (0x 접두사 포함)
   * - gasLimit: Hex String (0x 접두사 포함, "gas"로 표시)
   * - to: Address 또는 null (컨트랙트 배포 시 null)
   */
  toJSON() {
    // data 필드를 Hex String으로 변환 (Buffer/Uint8Array 안전 처리)
    let dataHex: string;
    const d: unknown = this.data as unknown;
    if (typeof d === 'string') {
      if (d.length === 0) dataHex = '0x';
      else dataHex = d.startsWith('0x') ? d : `0x${d}`;
    } else if (d && typeof d === 'object' && (d as any).buffer) {
      // Buffer 또는 Uint8Array로 간주
      const bytes = Buffer.isBuffer(d) ? (d as Buffer) : Buffer.from(d as Uint8Array);
      dataHex = bytes.length ? `0x${bytes.toString('hex')}` : '0x';
    } else {
      dataHex = '0x';
    }

    return {
      hash: this.hash,
      from: this.from,
      to: this.to, // null이면 null 그대로 반환 (컨트랙트 배포 트랜잭션)
      value: `0x${this.value.toString(16)}`,
      nonce: `0x${this.nonce.toString(16)}`,
      data: dataHex,
      gasPrice: `0x${this.gasPrice.toString(16)}`,
      gas: `0x${this.gasLimit.toString(16)}`, // 이더리움 표준에서는 "gas" 필드명 사용
      v: `0x${this.v.toString(16)}`,
      r: this.r,
      s: this.s,
      status: this.status,
      blockNumber: this.blockNumber
        ? `0x${this.blockNumber.toString(16)}`
        : undefined,
      timestamp: `0x${Math.floor(this.timestamp.getTime() / 1000).toString(16)}`,
    };
  }
}
