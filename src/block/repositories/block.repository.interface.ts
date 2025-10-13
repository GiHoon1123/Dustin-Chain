import { Hash } from '../../common/types/common.types';
import { Block } from '../entities/block.entity';

/**
 * Block Repository Interface
 *
 * 블록 저장소 추상화
 *
 * 이더리움:
 * - LevelDB에 블록 저장
 * - Key: 블록 해시 or 블록 번호
 * - Value: RLP 인코딩된 블록 데이터
 *
 * 우리:
 * - 현재: In-Memory (Map)
 * - 나중에: LevelDB 또는 PostgreSQL
 */
export interface IBlockRepository {
  /**
   * 블록 번호로 조회
   */
  findByNumber(number: number): Promise<Block | null>;

  /**
   * 블록 해시로 조회
   */
  findByHash(hash: Hash): Promise<Block | null>;

  /**
   * 최신 블록 조회
   */
  findLatest(): Promise<Block | null>;

  /**
   * 블록 저장
   */
  save(block: Block): Promise<void>;

  /**
   * 전체 블록 개수 (체인 높이)
   */
  count(): Promise<number>;

  /**
   * 모든 블록 조회 (테스트/디버깅용)
   */
  findAll(): Promise<Block[]>;

  /**
   * 저장소 초기화 (테스트용)
   */
  clear(): Promise<void>;
}

export const IBlockRepository = Symbol('IBlockRepository');
