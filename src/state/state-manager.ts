import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Account } from '../account/entities/account.entity';
import { Address } from '../common/types/common.types';
import { IStateRepository } from '../storage/repositories/state.repository.interface';

/**
 * StateManager
 *
 * 역할:
 * - 트랜잭션 실행 중 임시 상태 관리 (저널링)
 * - 블록 커밋 시 IStateRepository에 저장
 * - 캐시 관리 (성능 최적화)
 *
 * 변경사항 (State Trie 도입):
 * - 기존: 자체 LevelDB 관리
 * - 현재: IStateRepository 사용 (State Trie + LevelDB)
 * - 저널링은 그대로 유지 (트랜잭션 원자성)
 */
@Injectable()
export class StateManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StateManager.name);

  // 캐시: 최근 접근한 계정들
  private cache: Map<Address, Account> = new Map();

  // 저널링: 현재 블록 실행 중 변경분
  private journal: Map<Address, Account> = new Map();

  // 캐시 크기 제한
  private readonly CACHE_SIZE_LIMIT = 1000;

  constructor(private readonly stateRepository: IStateRepository) {}

  async onModuleInit(): Promise<void> {
    // IStateRepository가 이미 초기화됨 (Global Module)
    this.logger.log('StateManager initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // IStateRepository는 StorageModule에서 관리
    this.logger.log('StateManager closed');
  }

  /**
   * 계정 조회: 저널 -> 캐시 -> StateRepository 순서로 찾기
   * 계정이 없으면 null 반환 (새로 생성하지 않음)
   */
  async getAccount(address: Address): Promise<Account | null> {
    // 1. 저널에서 찾기 (현재 블록 실행 중 변경분)
    if (this.journal.has(address)) {
      return this.journal.get(address)!;
    }

    // 2. 캐시에서 찾기
    if (this.cache.has(address)) {
      return this.cache.get(address)!;
    }

    // 3. StateRepository에서 찾기 (State Trie + LevelDB)
    try {
      const account = await this.stateRepository.getAccount(address);

      if (account) {
        // 캐시에 추가 (크기 제한 확인)
        this.addToCache(address, account);
      }

      return account;
    } catch (error: any) {
      this.logger.error('Failed to get account from StateRepository:', error);
      throw error;
    }
  }

  /**
   * 계정 저장: 저널에 추가 (블록 커밋 시 DB에 저장)
   */
  async setAccount(address: Address, account: Account): Promise<void> {
    this.journal.set(address, account);
    this.logger.debug(`Account ${address} added to journal`);
  }

  /**
   * 계정 삭제: 저널에 null로 표시
   */
  async deleteAccount(address: Address): Promise<void> {
    this.journal.set(address, null as any);
    this.logger.debug(`Account ${address} marked for deletion in journal`);
  }

  /**
   * 블록 시작: 저널 초기화
   */
  async startBlock(): Promise<void> {
    this.journal.clear();
    this.logger.debug('Block started - journal cleared');
  }

  /**
   * 블록 커밋: 저널의 변경사항을 StateRepository에 저장
   */
  async commitBlock(): Promise<void> {
    for (const [address, account] of this.journal.entries()) {
      if (account === null) {
        // 계정 삭제는 현재 지원하지 않음 (이더리움도 마찬가지)
        // 잔액 0인 계정도 State Trie에 남음
        this.cache.delete(address);
        this.logger.debug(`Account ${address} marked for deletion (skipped)`);
      } else {
        // 계정 저장 - State Trie에 저장
        await this.stateRepository.saveAccount(account);
        this.addToCache(address, account);
        this.logger.debug(`Account ${address} committed to StateRepository`);
      }
    }

    this.journal.clear();
    this.logger.log('Block committed - journal cleared');
  }

  /**
   * 블록 롤백: 저널 초기화 (변경사항 취소)
   */
  async rollbackBlock(): Promise<void> {
    this.journal.clear();
    this.logger.log('Block rolled back - journal cleared');
  }

  /**
   * 캐시에 계정 추가 (크기 제한 확인)
   */
  private addToCache(address: Address, account: Account): void {
    if (this.cache.size >= this.CACHE_SIZE_LIMIT) {
      // LRU 방식으로 가장 오래된 항목 제거
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(address, account);
  }

  /**
   * 캐시 통계
   */
  getCacheStats(): { size: number; limit: number } {
    return {
      size: this.cache.size,
      limit: this.CACHE_SIZE_LIMIT,
    };
  }

  /**
   * 저널 통계
   */
  getJournalStats(): { size: number } {
    return {
      size: this.journal.size,
    };
  }

  /**
   * DB 통계 (대략적인 계정 수)
   *
   * 주의: State Trie는 전체 조회를 지원하지 않음
   * 캐시와 저널의 크기만 반환
   */
  async getDBStats(): Promise<{ cacheSize: number; journalSize: number }> {
    return {
      cacheSize: this.cache.size,
      journalSize: this.journal.size,
    };
  }
}
