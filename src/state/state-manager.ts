import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Level } from 'level';
import { Account } from '../account/entities/account.entity';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';

@Injectable()
export class StateManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StateManager.name);
  private db: Level<string, string>;

  // 캐시: 최근 접근한 계정들
  private cache: Map<Address, Account> = new Map();

  // 저널링: 현재 블록 실행 중 변경분
  private journal: Map<Address, Account> = new Map();

  // 캐시 크기 제한
  private readonly CACHE_SIZE_LIMIT = 1000;

  constructor(private readonly cryptoService: CryptoService) {}

  async onModuleInit(): Promise<void> {
    try {
      // LevelDB 초기화
      this.db = new Level('./data/state', {
        valueEncoding: 'utf8',
        createIfMissing: true,
      });

      this.logger.log('StateManager initialized with LevelDB');
    } catch (error) {
      this.logger.error('Failed to initialize StateManager:', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.logger.log('StateManager closed');
    }
  }

  /**
   * 계정 조회: 저널 -> 캐시 -> DB 순서로 찾기
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

    // 3. DB에서 찾기 (DB가 열려있을 때만)
    try {
      if (this.db.status === 'open') {
        const accountData = await this.db.get(`account:${address}`);
        if (accountData) {
          // Ethereum 2.0 방식: RLP 디코딩 후 Account 객체로 변환
          const account = this.deserializeAccount(accountData);

          // 캐시에 추가 (크기 제한 확인)
          this.addToCache(address, account);

          return account;
        }
      } else {
        // DB가 아직 열리지 않았으면 캐시에서만 조회
        this.logger.debug(
          'DB not open yet, returning null for account:',
          address,
        );
        return null;
      }
    } catch (error) {
      // DB에 없으면 null 반환
      if (
        error.code === 'LEVEL_NOT_FOUND' ||
        error.code === 'LEVEL_DATABASE_NOT_OPEN'
      ) {
        return null;
      }
      this.logger.error('Failed to get account from DB:', error);
      throw error;
    }

    return null;
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
   * 블록 커밋: 저널의 변경사항을 DB에 저장
   */
  async commitBlock(): Promise<void> {
    for (const [address, account] of this.journal.entries()) {
      if (account === null) {
        // 계정 삭제
        try {
          await this.db.del(`account:${address}`);
          this.cache.delete(address);
          this.logger.debug(`Account ${address} deleted from DB`);
        } catch (error) {
          if (error.code !== 'LEVEL_NOT_FOUND') {
            throw error;
          }
        }
      } else {
        // 계정 저장 - Ethereum 2.0 방식: RLP 인코딩
        const serializedAccount = this.serializeAccount(account);
        await this.db.put(`account:${address}`, serializedAccount);
        this.addToCache(address, account);
        this.logger.debug(`Account ${address} committed to DB`);
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
   * 계정을 Ethereum 2.0 방식으로 직렬화 (RLP 인코딩)
   */
  private serializeAccount(account: Account): string {
    // Ethereum 2.0 계정 구조: [nonce, balance, storageRoot, codeHash]
    const accountData = [
      account.nonce.toString(),
      account.balance.toString(),
      '0x0000000000000000000000000000000000000000000000000000000000000000', // storageRoot (EOA는 빈 해시)
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', // codeHash (EOA는 빈 해시)
    ];

    // RLP 인코딩 후 hex 문자열로 변환
    const rlpEncoded = this.cryptoService.rlpEncode(accountData);
    return Buffer.from(rlpEncoded).toString('hex');
  }

  /**
   * Ethereum 2.0 방식으로 역직렬화 (RLP 디코딩)
   */
  private deserializeAccount(serializedData: string): Account {
    try {
      // hex 문자열을 Uint8Array로 변환 후 RLP 디코딩
      const hexBuffer = Buffer.from(serializedData, 'hex');
      const decoded = this.cryptoService.rlpDecode(hexBuffer);

      // Ethereum 2.0 계정 구조: [nonce, balance, storageRoot, codeHash]
      const [nonce, balance] = decoded as [string, string];

      // Account 객체 생성 (address는 키에서 추출)
      const account = new Account(''); // address는 나중에 설정
      account.nonce = parseInt(nonce);
      account.balance = BigInt(balance);

      return account;
    } catch (error) {
      this.logger.error('Failed to deserialize account:', error);
      throw new Error('Invalid account data in database');
    }
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
   */
  async getDBStats(): Promise<{ accountCount: number }> {
    let accountCount = 0;

    for await (const key of this.db.keys({
      gte: 'account:',
      lt: 'account:~',
    })) {
      accountCount++;
    }

    return { accountCount };
  }

  /**
   * 에포크 체크포인트 저장 (32블록마다 - Ethereum 2.0 방식)
   */
  async saveEpochCheckpoint(
    epoch: number,
    blockNumber: number,
    stateRoot: string,
  ): Promise<void> {
    await this.db.put(
      `epoch:${epoch}`,
      JSON.stringify({
        epoch,
        blockNumber,
        stateRoot,
        timestamp: Date.now(),
      }),
    );

    this.logger.log(
      `Epoch checkpoint saved: epoch=${epoch}, block=${blockNumber}`,
    );
  }

  /**
   * 마지막 에포크 체크포인트 로드
   */
  async loadLastEpochCheckpoint(): Promise<{
    epoch: number;
    blockNumber: number;
    stateRoot: string;
  } | null> {
    try {
      const keys: string[] = [];
      for await (const key of this.db.keys({
        gt: 'epoch:',
        lt: 'epoch:~',
      })) {
        keys.push(key);
      }

      if (keys.length === 0) return null;

      const lastKey = keys[keys.length - 1];
      const data = await this.db.get(lastKey);
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * 특정 에포크 체크포인트 로드
   */
  async loadEpochCheckpoint(
    epoch: number,
  ): Promise<{ epoch: number; blockNumber: number; stateRoot: string } | null> {
    try {
      const data = await this.db.get(`epoch:${epoch}`);
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * 에포크 체크포인트 복구 (서버 재시작 시)
   */
  async recoverFromCheckpoint(): Promise<{
    epoch: number;
    blockNumber: number;
    stateRoot: string;
  } | null> {
    const checkpoint = await this.loadLastEpochCheckpoint();

    if (checkpoint) {
      this.logger.log(
        `Recovering from checkpoint: epoch=${checkpoint.epoch}, block=${checkpoint.blockNumber}`,
      );

      // 캐시 초기화
      this.cache.clear();
      this.journal.clear();

      return checkpoint;
    }

    this.logger.log('No checkpoint found - starting from genesis');
    return null;
  }
}
