import { Injectable } from '@nestjs/common';
import { Hash } from '../../common/types/common.types';
import { Block } from '../entities/block.entity';
import { IBlockRepository } from './block.repository.interface';

/**
 * In-Memory Block Repository
 *
 * In-Memory 블록 저장소
 *
 * 저장 구조:
 * - byNumber: Map<number, Block> - 블록 번호로 빠른 조회
 * - byHash: Map<Hash, Block> - 블록 해시로 빠른 조회
 * - latestBlock: Block - 최신 블록 캐시
 *
 * 장점:
 * - 빠른 개발/테스트
 * - 복잡한 DB 설정 불필요
 *
 * 단점:
 * - 서버 재시작 시 데이터 손실
 * - 메모리 제한
 *
 * 나중에:
 * - LevelDB 또는 PostgreSQL로 교체
 * - Repository Pattern 덕분에 Service 코드 수정 없이 교체 가능
 */
@Injectable()
export class BlockMemoryRepository implements IBlockRepository {
  private byNumber: Map<number, Block> = new Map();
  private byHash: Map<Hash, Block> = new Map();
  private latestBlock: Block | null = null;

  async findByNumber(number: number): Promise<Block | null> {
    const block = this.byNumber.get(number);
    return Promise.resolve(block || null);
  }

  async findByHash(hash: Hash): Promise<Block | null> {
    const normalizedHash = hash.toLowerCase();
    const block = this.byHash.get(normalizedHash);
    return Promise.resolve(block || null);
  }

  async findLatest(): Promise<Block | null> {
    return Promise.resolve(this.latestBlock);
  }

  async save(block: Block): Promise<void> {
    const normalizedHash = block.hash.toLowerCase();

    // 블록 번호로 저장
    this.byNumber.set(block.number, block);

    // 블록 해시로 저장
    this.byHash.set(normalizedHash, block);

    // 최신 블록 업데이트
    if (!this.latestBlock || block.number > this.latestBlock.number) {
      this.latestBlock = block;
    }

    return Promise.resolve();
  }

  async count(): Promise<number> {
    return Promise.resolve(this.byNumber.size);
  }

  async findAll(): Promise<Block[]> {
    // 블록 번호 순서대로 정렬
    const blocks = Array.from(this.byNumber.values());
    blocks.sort((a, b) => a.number - b.number);
    return Promise.resolve(blocks);
  }

  async clear(): Promise<void> {
    this.byNumber.clear();
    this.byHash.clear();
    this.latestBlock = null;
    return Promise.resolve();
  }
}
