import { Account } from '../../account/entities/account.entity';
import { Address, Hash } from '../../common/types/common.types';

/**
 * State Repository Interface
 *
 * 이더리움에서의 State:
 * - World State: 모든 계정의 현재 상태
 * - State Trie: Merkle Patricia Trie로 저장
 * - LevelDB에 영구 저장
 *
 * 역할:
 * - 계정 상태 저장/조회
 * - State Root 관리
 * - LevelDB와 Trie 연결
 */
export abstract class IStateRepository {
  /**
   * 계정 조회
   *
   * @param address - 계정 주소
   * @returns Account 또는 null (존재하지 않으면)
   */
  abstract getAccount(address: Address): Promise<Account | null>;

  /**
   * 계정 저장
   *
   * 동작:
   * - State Trie에 저장
   * - LevelDB에 자동 저장됨
   * - State Root 자동 업데이트
   *
   * @param account - 저장할 계정
   */
  abstract saveAccount(account: Account): Promise<void>;

  /**
   * 계정 존재 여부 확인
   *
   * @param address - 계정 주소
   * @returns 존재 여부
   */
  abstract hasAccount(address: Address): Promise<boolean>;

  /**
   * 현재 State Root 조회
   *
   * State Root:
   * - State Trie의 Root Hash
   * - 전체 계정 상태의 "지문"
   * - 블록 Header에 저장됨
   *
   * @returns State Root Hash
   */
  abstract getStateRoot(): Hash;

  /**
   * State Root 설정 (복원 시)
   *
   * 용도:
   * - 서버 재시작 시 특정 블록의 State 복원
   * - StateRoot로 Trie 연결
   *
   * @param root - 복원할 State Root
   */
  abstract setStateRoot(root: Hash): Promise<void>;

  /**
   * 데이터베이스 초기화
   */
  abstract initialize(): Promise<void>;

  /**
   * 데이터베이스 닫기
   */
  abstract close(): Promise<void>;
}


