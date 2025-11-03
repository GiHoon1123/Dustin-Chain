import { createMPT, MerklePatriciaTrie } from '@ethereumjs/mpt';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import { Account } from '../../account/entities/account.entity';
import {
  EMPTY_HASH,
  EMPTY_ROOT,
} from '../../common/constants/blockchain.constants';
import { CryptoService } from '../../common/crypto/crypto.service';
import { Address, Hash } from '../../common/types/common.types';
import { IStateRepository } from './state.repository.interface';

/**
 * StateLevelDBRepository (Ethereum Geth 방식)
 *
 * Geth의 State 저장 방식:
 * - LevelDB에 Merkle Patricia Trie 저장
 * - Key: Keccak256(address) → Value: RLP([nonce, balance, storageRoot, codeHash])
 * - Trie의 모든 노드가 LevelDB에 저장됨
 *
 * State Trie 구조:
 * - Key: keccak256(address) → 32 bytes
 * - Value: RLP([nonce, balance, storageRoot, codeHash])
 *
 * 복원 과정:
 * 1. LevelDB 열기
 * 2. 최신 블록의 stateRoot 가져오기
 * 3. stateRoot로 Trie 연결
 * 4. 이제 모든 계정 조회 가능
 */
@Injectable()
export class StateLevelDBRepository
  implements IStateRepository, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StateLevelDBRepository.name);
  private db: ClassicLevel;
  private trie: MerklePatriciaTrie;
  private currentRoot: Uint8Array;

  constructor(private readonly cryptoService: CryptoService) {}

  /**
   * 모듈 초기화
   *
   * 동작:
   * 1. LevelDB 열기 (data/state)
   * 2. 빈 Trie 생성 (LevelDB 연결)
   * 3. 현재 Root 저장
   */
  async onModuleInit() {
    try {
      this.db = new ClassicLevel('data/state');
      await this.db.open();
      // this.logger.log('State LevelDB opened');

      // 메모리 Trie 생성 (계정 저장 시 LevelDB에도 직접 저장)
      this.trie = await createMPT();
      this.currentRoot = this.trie.root();

      // this.logger.log(
      //   `State Trie initialized with root: ${this.cryptoService.bytesToHex(this.currentRoot)}`,
      // );
    } catch (error: any) {
      this.logger.error('Failed to initialize State LevelDB:', error);
      throw error;
    }
  }

  /**
   * 데이터베이스 초기화 (명시적 호출용)
   */
  async initialize(): Promise<void> {
    // onModuleInit에서 이미 처리됨
  }

  /**
   * 계정 조회
   *
   * 동작:
   * 1. address → keccak256(address) 변환
   * 2. Trie에서 조회
   * 3. RLP 디코딩
   * 4. Account 객체 생성
   *
   * @param address - 계정 주소
   * @returns Account 또는 null
   */
  async getAccount(address: Address): Promise<Account | null> {
    try {
      if (this.db.status !== 'open') {
        this.logger.warn(`Cannot get account ${address}: DB not open yet`);
        return null;
      }

      // LevelDB에서 직접 조회
      const dbKey = `account:${address}`;

      try {
        const value = await this.db.get(dbKey);
        if (!value) {
          return null;
        }
        const decoded = this.cryptoService.rlpDecode(
          Buffer.from(value, 'hex'),
        ) as any[];

        // RLP decoding: 빈 Buffer는 0으로 처리
        const nonceBuffer = decoded[0];
        const nonce =
          !nonceBuffer || nonceBuffer.length === 0
            ? 0
            : parseInt(nonceBuffer.toString('hex'), 16);

        // ✅ Balance: RLP는 bigint를 Buffer로 인코딩함
        const balanceBuffer = decoded[1];
        let balance = 0n;
        if (balanceBuffer && balanceBuffer.length > 0) {
          const balanceHex = balanceBuffer.toString('hex');
          balance = BigInt('0x' + balanceHex);
        }

        // storageRoot / codeHash (신규 필드)
        const storageRootBuf = decoded[2];
        const codeHashBuf = decoded[3];
        const storageRoot = storageRootBuf
          ? this.cryptoService.bytesToHex(storageRootBuf)
          : EMPTY_ROOT;
        const codeHash = codeHashBuf
          ? this.cryptoService.bytesToHex(codeHashBuf)
          : EMPTY_HASH;

        const account = new Account(address);
        account.nonce = nonce;
        account.balance = balance;
        account.storageRoot = storageRoot;
        account.codeHash = codeHash;

        // this.logger.debug(
        //   `Account retrieved: ${address} (nonce: ${nonce}, balance: ${balance})`,
        // );

        return account;
      } catch (error: any) {
        if (error.code === 'LEVEL_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    } catch (error: any) {
      this.logger.error(`Failed to get account ${address}:`, error);
      return null;
    }
  }

  /**
   * 계정 저장
   *
   * 동작:
   * 1. Account → RLP 인코딩
   * 2. address → keccak256(address) 변환
   * 3. Trie에 저장
   * 4. LevelDB에 자동 저장됨
   * 5. State Root 자동 업데이트
   *
   * @param account - 저장할 계정
   */
  async saveAccount(account: Account): Promise<void> {
    try {
      if (this.db.status !== 'open') {
        this.logger.warn(
          `Cannot save account ${account.address}: DB not open yet`,
        );
        return;
      }

      // Value: RLP([nonce, balance, storageRoot, codeHash])
      // ✅ bigint를 그대로 전달 (RLP가 자동으로 최소 바이트로 변환)
      const value = this.cryptoService.rlpEncode([
        account.nonce,
        account.balance, // ✅ bigint 그대로 (이더리움 표준)
        this.cryptoService.hexToBytes(account.storageRoot || EMPTY_ROOT),
        this.cryptoService.hexToBytes(account.codeHash || EMPTY_HASH),
      ]);

      // 1. Trie에 저장 (State Root 계산용)
      const trieKey = this.cryptoService.hexToBytes(
        this.cryptoService.hashHex(account.address),
      );
      await this.trie.put(trieKey, value);

      // 2. LevelDB에 직접 저장 (영구 저장)
      const dbKey = `account:${account.address}`;
      await this.db.put(dbKey, Buffer.from(value).toString('hex'));

      // State Root 자동 업데이트
      this.currentRoot = this.trie.root();

      // this.logger.debug(
      //   `Account saved: ${account.address} (nonce: ${account.nonce}, balance: ${account.balance})`,
      // );
      // this.logger.debug(
      //   `New State Root: ${this.cryptoService.bytesToHex(this.currentRoot)}`,
      // );
    } catch (error: any) {
      this.logger.error(`Failed to save account ${account.address}:`, error);
      throw error;
    }
  }

  /**
   * 계정 존재 여부 확인
   *
   * @param address - 계정 주소
   * @returns 존재 여부
   */
  async hasAccount(address: Address): Promise<boolean> {
    const account = await this.getAccount(address);
    return account !== null;
  }

  /**
   * 현재 State Root 조회
   *
   * @returns State Root Hash (0x...)
   */
  getStateRoot(): Hash {
    return this.cryptoService.bytesToHex(this.currentRoot);
  }

  /**
   * State Root 설정 (복원 시)
   *
   * 용도:
   * - 서버 재시작 시 특정 블록의 State 복원
   * - StateRoot로 Trie 연결
   *
   * 동작:
   * 1. root를 Buffer로 변환
   * 2. 해당 root로 새 Trie 생성
   * 3. LevelDB에서 해당 root의 노드들을 자동으로 로드
   *
   * @param root - 복원할 State Root
   */
  async setStateRoot(root: Hash): Promise<void> {
    try {
      this.currentRoot = this.cryptoService.hexToBytes(root);

      // LevelDB에서 모든 계정을 읽어서 Trie 재구성
      this.trie = await createMPT();

      for await (const [key, value] of this.db.iterator({
        gte: 'account:',
        lt: 'account:~',
      })) {
        // key: "account:0x..."
        const address = key.slice(8); // "account:" 제거
        const trieKey = this.cryptoService.hexToBytes(
          this.cryptoService.hashHex(address),
        );
        await this.trie.put(trieKey, Buffer.from(value, 'hex'));
      }

      this.currentRoot = this.trie.root();

      // this.logger.log(
      //   `State Root restored to: ${this.cryptoService.bytesToHex(this.currentRoot)}`,
      // );
    } catch (error: any) {
      this.logger.error(`Failed to set State Root to ${root}:`, error);
      throw error;
    }
  }

  /**
   * 데이터베이스 닫기
   */
  async onModuleDestroy() {
    try {
      if (this.db && this.db.status === 'open') {
        await this.db.close();
        // this.logger.log('State LevelDB closed');
      }
    } catch (error: any) {
      this.logger.error('Failed to close State LevelDB:', error);
    }
  }

  /**
   * 데이터베이스 닫기 (명시적 호출용)
   */
  async close(): Promise<void> {
    await this.onModuleDestroy();
  }
}
