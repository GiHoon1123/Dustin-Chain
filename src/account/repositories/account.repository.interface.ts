import { Address } from '../../common/types/common.types';
import { Account } from '../entities/account.entity';

/**
 * Account Repository Interface
 *
 * 왜 인터페이스?
 * - 저장소 구현을 쉽게 교체 가능
 * - In-Memory → LevelDB → PostgreSQL
 * - Service는 인터페이스에만 의존
 * - 테스트 시 Mock 구현 쉬움
 *
 * Repository 패턴:
 * - 데이터 접근 로직 분리
 * - 비즈니스 로직(Service)과 저장소(Repository) 분리
 * - 이더리움 Geth도 비슷한 패턴 사용
 */
export interface IAccountRepository {
  /**
   * 계정 조회
   *
   * @param address - 계정 주소
   * @returns Account 또는 null (없으면)
   */
  findByAddress(address: Address): Promise<Account | null>;

  /**
   * 계정 저장 (생성 or 업데이트)
   *
   * @param account - 저장할 계정
   */
  save(account: Account): Promise<void>;

  /**
   * 계정 존재 여부 확인
   *
   * @param address - 계정 주소
   * @returns 존재하면 true
   */
  exists(address: Address): Promise<boolean>;

  /**
   * 모든 계정 조회
   *
   * 용도:
   * - Genesis 초기화
   * - 관리자 페이지
   * - 디버깅
   *
   * 주의:
   * - 실제 블록체인에서는 수백만 개
   * - 페이지네이션 필요 (나중에)
   */
  findAll(): Promise<Account[]>;

  /**
   * 모든 계정 삭제
   *
   * 용도:
   * - 테스트 초기화
   * - 재시작 시 초기화
   */
  clear(): Promise<void>;
}
