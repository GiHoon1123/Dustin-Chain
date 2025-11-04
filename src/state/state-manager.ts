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

  // 저널링 스택: 중첩된 checkpoint 지원 (이더리움과 동일)
  // 스택의 각 레벨은 독립적인 변경사항을 추적
  // 예: [블록 checkpoint, 트랜잭션 checkpoint, eth_call checkpoint, ...]
  private journalStack: Map<Address, Account>[] = [];

  // 캐시 크기 제한
  private readonly CACHE_SIZE_LIMIT = 1000;

  constructor(private readonly stateRepository: IStateRepository) {}

  async onModuleInit(): Promise<void> {
    // IStateRepository가 이미 초기화됨 (Global Module)
    // this.logger.log('StateManager initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // IStateRepository는 StorageModule에서 관리
    // this.logger.log('StateManager closed');
  }

  /**
   * 계정 조회: 저널 스택 (최상단부터) -> 캐시 -> StateRepository 순서로 찾기
   * 계정이 없으면 null 반환 (새로 생성하지 않음)
   */
  async getAccount(address: Address): Promise<Account | null> {
    // 1. 저널 스택에서 찾기 (최상단부터, 가장 최근 변경사항 우선)
    for (let i = this.journalStack.length - 1; i >= 0; i--) {
      const journal = this.journalStack[i];
      if (journal.has(address)) {
        const account = journal.get(address)!;
        // null은 삭제 표시이므로 null 반환
        if (account === null) {
          return null;
        }
        return account;
      }
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
   * 계정 저장: 저널 스택 최상단에 추가 (블록 커밋 시 DB에 저장)
   */
  setAccount(address: Address, account: Account): void {
    if (this.journalStack.length === 0) {
      // 스택이 비어있으면 새 checkpoint 생성
      this.journalStack.push(new Map());
    }
    const topJournal = this.journalStack[this.journalStack.length - 1];
    topJournal.set(address, account);
    // this.logger.debug(`Account ${address} added to journal (depth: ${this.journalStack.length})`);
  }

  /**
   * 계정 삭제: 저널 스택 최상단에 null로 표시
   */
  deleteAccount(address: Address): void {
    if (this.journalStack.length === 0) {
      // 스택이 비어있으면 새 checkpoint 생성
      this.journalStack.push(new Map());
    }
    const topJournal = this.journalStack[this.journalStack.length - 1];
    topJournal.set(address, null as any);
    // this.logger.debug(`Account ${address} marked for deletion in journal (depth: ${this.journalStack.length})`);
  }

  /**
   * 블록 시작: 저널 스택 초기화 후 새 checkpoint 생성
   *
   * 이더리움과 동일하게 동작:
   * - 블록 시작 시 기존 스택을 비우고 새 checkpoint 생성
   * - 각 블록은 독립적인 실행 컨텍스트를 가짐
   */
  startBlock(): void {
    this.journalStack = [];
    this.journalStack.push(new Map<Address, Account>());
    // this.logger.debug(`Block started - journal stack reset (depth: ${this.journalStack.length})`);
  }

  /**
   * Checkpoint 생성: 스택에 새 레벨 추가 (중첩 지원)
   *
   * 이더리움과 동일하게 동작:
   * - 새 checkpoint를 스택에 push
   * - 중첩 가능 (블록 > 트랜잭션 > eth_call > 내부 호출 등)
   */
  checkpoint(): void {
    this.journalStack.push(new Map<Address, Account>());
    // this.logger.debug(`Checkpoint created (depth: ${this.journalStack.length})`);
  }

  /**
   * Checkpoint 커밋: 스택 최상단 pop 후 하위 레벨에 병합
   *
   * 이더리움과 동일하게 동작:
   * - 최상단 레벨의 변경사항을 하위 레벨에 병합
   * - 스택에서 최상단 제거
   */
  commitCheckpoint(): void {
    if (this.journalStack.length === 0) {
      throw new Error('Cannot commit: journal stack is empty');
    }
    if (this.journalStack.length === 1) {
      // 최하위 레벨이면 그냥 제거 (나중에 commitBlock에서 저장)
      this.journalStack.pop();
      return;
    }

    // 최상단 레벨 pop
    const topJournal = this.journalStack.pop()!;
    // 하위 레벨에 병합 (최상단이 우선)
    const lowerJournal = this.journalStack[this.journalStack.length - 1];
    for (const [address, account] of topJournal.entries()) {
      lowerJournal.set(address, account);
    }
    // this.logger.debug(`Checkpoint committed (depth: ${this.journalStack.length})`);
  }

  /**
   * Checkpoint 롤백: 스택 최상단 pop만 (저장 안 함)
   *
   * 이더리움과 동일하게 동작:
   * - 최상단 레벨을 제거하여 변경사항 취소
   * - 하위 레벨은 그대로 유지
   */
  revertCheckpoint(): void {
    if (this.journalStack.length === 0) {
      throw new Error('Cannot revert: journal stack is empty');
    }
    this.journalStack.pop();
    // this.logger.debug(`Checkpoint reverted (depth: ${this.journalStack.length})`);
  }

  /**
   * 블록 커밋: 저널 스택의 모든 변경사항을 StateRepository에 저장
   *
   * 이더리움과 동일하게 동작:
   * - 스택의 모든 레벨을 병합하여 저장
   * - 최상단 레벨이 최신 상태이므로 하위 레벨과 병합
   */
  async commitBlock(): Promise<void> {
    // 스택이 비어있으면 저장할 것이 없음
    if (this.journalStack.length === 0) {
      // this.logger.debug('Block committed - journal stack was empty');
      return;
    }

    // 모든 저널 레벨을 병합 (최상단이 우선)
    const mergedJournal = new Map<Address, Account>();
    for (const journal of this.journalStack) {
      for (const [address, account] of journal.entries()) {
        mergedJournal.set(address, account);
      }
    }

    // 병합된 변경사항을 StateRepository에 저장
    for (const [address, account] of mergedJournal.entries()) {
      if (account === null) {
        // 계정 삭제는 현재 지원하지 않음 (이더리움도 마찬가지)
        // 잔액 0인 계정도 State Trie에 남음
        this.cache.delete(address);
        // this.logger.debug(`Account ${address} marked for deletion (skipped)`);
      } else {
        // 계정 저장 - State Trie에 저장
        await this.stateRepository.saveAccount(account);
        this.addToCache(address, account);
        // this.logger.debug(`Account ${address} committed to StateRepository`);
      }
    }

    // 스택 초기화
    this.journalStack = [];
    // this.logger.log(`Block committed - journal stack cleared (was depth: ${this.journalStack.length})`);
  }

  /**
   * 블록 롤백: 저널 스택 초기화 (변경사항 취소)
   *
   * 이더리움과 동일하게 동작:
   * - 스택의 모든 레벨을 제거하여 변경사항 취소
   */
  rollbackBlock(): void {
    const depth = this.journalStack.length;
    this.journalStack = [];
    // this.logger.log(`Block rolled back - journal stack cleared (was depth: ${depth})`);
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
  getJournalStats(): { size: number; depth: number } {
    // 모든 저널 레벨의 총 크기 계산
    let totalSize = 0;
    for (const journal of this.journalStack) {
      totalSize += journal.size;
    }
    return {
      size: totalSize,
      depth: this.journalStack.length,
    };
  }

  /**
   * DB 통계 (대략적인 계정 수)
   *
   * 주의: State Trie는 전체 조회를 지원하지 않음
   * 캐시와 저널의 크기만 반환
   */
  getDBStats(): {
    cacheSize: number;
    journalSize: number;
    journalDepth: number;
  } {
    // 모든 저널 레벨의 총 크기 계산
    let totalSize = 0;
    for (const journal of this.journalStack) {
      totalSize += journal.size;
    }
    return {
      cacheSize: this.cache.size,
      journalSize: totalSize,
      journalDepth: this.journalStack.length,
    };
  }
}
