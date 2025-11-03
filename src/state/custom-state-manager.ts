import { StateManagerInterface } from '@ethereumjs/common';
import { Account as EthAccount, createAccount } from '@ethereumjs/util';
import { Injectable, Logger } from '@nestjs/common';
import { ClassicLevel } from 'classic-level';
import { Account } from '../account/entities/account.entity';
import {
  EMPTY_HASH,
  EMPTY_ROOT,
} from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { IStateRepository } from '../storage/repositories/state.repository.interface';
import { StateManager } from './state-manager';

/**
 * CustomStateManager
 *
 * 역할:
 * - @ethereumjs/vm이 기대하는 StateManager 인터페이스의 최소 기능을 제공
 * - 내부적으로 우리의 StateManager를 래핑하여 상태를 저장/조회
 * - 컨트랙트 관련 기능은 점진적으로 확장 (현재는 EOA 전송 중심 최소 구현)
 */
@Injectable()
export class CustomStateManager {
  private readonly logger = new Logger(CustomStateManager.name);
  // 코드/스토리지 영속 저장용 LevelDB (네임스페이스 키 사용)
  private kv?: ClassicLevel<string, string>;

  constructor(
    private readonly stateManager: StateManager,
    private readonly stateRepository: IStateRepository,
    private readonly crypto: CryptoService,
  ) {}

  private async ensureDB(): Promise<void> {
    if (!this.kv) {
      const opts: any = { keyEncoding: 'utf8', valueEncoding: 'utf8' };
      const db = new ClassicLevel<string, string>('data/state', opts);
      await db.open();
      this.kv = db;
      this.logger.log('CustomStateManager KV opened (data/state)');
    }
  }

  /**
   * EVM이 기대하는 형태로 계정 조회
   * - 우리 Account → @ethereumjs/util.Account 변환
   */
  async getAccount(address: Address): Promise<EthAccount> {
    this.logger.debug(`getAccount(${address})`);
    const our = await this.stateManager.getAccount(address);
    if (!our) {
      // 존재하지 않는 계정은 nonce=0, balance=0, 빈 storage/code로 반환
      this.logger.debug(`getAccount(${address}) → not found, returning empty`);
      return createAccount({
        nonce: 0n,
        balance: 0n,
        storageRoot: this.crypto.hexToBytes(EMPTY_ROOT),
        codeHash: this.crypto.hexToBytes(EMPTY_HASH),
      });
    }
    this.logger.debug(
      `getAccount(${address}) → nonce=${our.nonce}, balance=${our.balance}`,
    );
    return this.toEthAccount(our);
  }

  /**
   * EVM이 수정한 계정 저장
   * - @ethereumjs/util.Account → 우리 Account 변환 후 저널에 기록
   */
  async putAccount(address: Address, eth: EthAccount): Promise<void> {
    const our = this.toOurAccount(address, eth);
    await this.stateManager.setAccount(address, our);
    this.logger.debug(
      `putAccount(${address}) nonce=${our.nonce}, balance=${our.balance}`,
    );
  }

  /**
   * 체크포인트/커밋/리버트는 우리 StateManager 저널과 매핑
   */
  async checkpoint(): Promise<void> {
    await this.stateManager.startBlock();
    this.logger.debug('checkpoint()');
  }

  async commit(): Promise<void> {
    await this.stateManager.commitBlock();
    this.logger.debug('commit()');
  }

  async revert(): Promise<void> {
    await this.stateManager.rollbackBlock();
    this.logger.debug('revert()');
  }

  /**
   * flush 메서드: 상태 변경사항을 즉시 디스크에 쓰기
   * @ethereumjs/vm@6.2.0에서 필요
   *
   * 우리의 StateManager는 저널 기반이므로:
   * - 커밋은 commit()에서 수행
   * - flush()는 빈 작업으로 구현 (VM이 요구하는 인터페이스만 충족)
   */
  async flush(): Promise<void> {
    // LevelDB는 자동으로 플러시되므로 추가 작업 불필요
    // ensureDB()를 호출하지 않음 (이미 열려있거나 필요할 때만 열리도록)
    this.logger.debug('flush() called (no-op)');
  }

  /**
   * StateManagerInterface 10.x 호환 메서드들
   */
  async deleteAccount(address: Address): Promise<void> {
    await this.stateManager.setAccount(address, new Account(address));
    this.logger.debug(`deleteAccount(${address})`);
  }

  async modifyAccountFields(
    address: Address,
    accountFields: {
      nonce?: bigint;
      balance?: bigint;
      storageRoot?: Uint8Array;
      codeHash?: Uint8Array;
    },
  ): Promise<void> {
    const acc =
      (await this.stateManager.getAccount(address)) || new Account(address);
    if (accountFields.nonce !== undefined) {
      acc.nonce = Number(accountFields.nonce);
    }
    if (accountFields.balance !== undefined) {
      acc.balance = accountFields.balance;
    }
    if (accountFields.storageRoot !== undefined) {
      acc.storageRoot = this.crypto.bytesToHex(accountFields.storageRoot);
    }
    if (accountFields.codeHash !== undefined) {
      acc.codeHash = this.crypto.bytesToHex(accountFields.codeHash);
    }
    await this.stateManager.setAccount(address, acc);
    this.logger.debug(`modifyAccountFields(${address})`);
  }

  async putCode(address: Address, value: Uint8Array): Promise<void> {
    await this.putContractCode(address, value);
  }

  async getCode(address: Address): Promise<Uint8Array> {
    return this.getContractCode(address);
  }

  async getCodeSize(address: Address): Promise<number> {
    const code = await this.getContractCode(address);
    return code.length;
  }

  async clearStorage(address: Address): Promise<void> {
    await this.ensureDB();
    const addressLower = address.toLowerCase();
    // 모든 스토리지 슬롯 삭제 (간단한 구현)
    // 실제로는 키를 순회하면서 삭제해야 하지만, 현재는 빈 구현
    this.logger.debug(`clearStorage(${address})`);
  }

  async getStateRoot(): Promise<Uint8Array> {
    const root = await this.stateRepository.getStateRoot();
    return Buffer.from(this.crypto.hexToBytes(root));
  }

  async setStateRoot(
    stateRoot: Uint8Array,
    clearCache?: boolean,
  ): Promise<void> {
    const rootHex = this.crypto.bytesToHex(stateRoot);
    await this.stateRepository.setStateRoot(rootHex);
    if (clearCache) {
      // 캐시 클리어는 StateManager에서 처리
    }
    this.logger.debug(`setStateRoot(${rootHex})`);
  }

  async hasStateRoot(root: Uint8Array): Promise<boolean> {
    const currentRoot = await this.getStateRoot();
    return Buffer.from(root).equals(currentRoot);
  }

  // originalStorageCache 구현 (최소 구현)
  originalStorageCache = {
    get: async (address: Address, key: Uint8Array): Promise<Uint8Array> => {
      return this.getContractStorage(address, key);
    },
    clear: (): void => {
      // 캐시 클리어는 필요시 구현
    },
  };

  clearCaches(): void {
    // 캐시 클리어
    this.logger.debug('clearCaches()');
  }

  shallowCopy(downlevelCaches?: boolean): StateManagerInterface {
    // 간단한 구현: 자기 자신 반환 (실제로는 복사해야 하지만 최소 구현)
    return this as unknown as StateManagerInterface;
  }

  /**
   * 컨트랙트 코드 조회 (codeHash 기반이 이상적이나, 현재는 주소 네임스페이스 + codeHash 보조)
   */
  async getContractCode(_address: Address): Promise<Uint8Array> {
    await this.ensureDB();
    const address = _address.toLowerCase();
    const codeHashKey = `account_codehash:${address}`;
    const storedHash = await this.kv!.get(codeHashKey).catch(() => undefined);
    let key: string | undefined;
    if (storedHash) key = `code:${storedHash}`;
    // Fallback: 주소 네임스페이스
    if (!key) key = `code:addr:${address}`;
    const hex = await this.kv!.get(key).catch(() => '');
    const bytes = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    this.logger.debug(
      `getContractCode(${_address}) → ${bytes.byteLength} bytes (key=${key})`,
    );
    return bytes;
  }

  /**
   * 컨트랙트 코드 저장: codeHash 계산 후 저장 + 계정.codeHash 갱신
   */
  async putContractCode(_address: Address, _code: Uint8Array): Promise<void> {
    await this.ensureDB();
    const address = _address.toLowerCase();
    const codeHash = this.crypto.hashBuffer(Buffer.from(_code));
    const codeKey = `code:${codeHash}`;
    await this.kv!.put(codeKey, Buffer.from(_code).toString('hex'));
    await this.kv!.put(`account_codehash:${address}`, codeHash);
    // 계정의 codeHash 갱신
    const acc =
      (await this.stateManager.getAccount(address)) || new Account(address);
    acc.codeHash = codeHash;
    await this.stateManager.setAccount(address, acc);
    this.logger.debug(
      `putContractCode(${_address}) ← ${_code.byteLength} bytes (codeHash=${codeHash})`,
    );
  }

  async getStorage(address: Address, key: Uint8Array): Promise<Uint8Array> {
    return this.getContractStorage(address, key);
  }

  async putStorage(
    address: Address,
    key: Uint8Array,
    value: Uint8Array,
  ): Promise<void> {
    return this.putContractStorage(address, key, value);
  }

  /**
   * 컨트랙트 스토리지 조회 (slot 키는 keccak(slot) 대신 원시 슬롯 바이트를 그대로 네임스페이스 키로 저장)
   */
  async getContractStorage(
    _address: Address,
    _key: Uint8Array,
  ): Promise<Uint8Array> {
    await this.ensureDB();
    const slot = Buffer.from(_key).toString('hex');
    const k = `storage:${_address.toLowerCase()}:${slot}`;
    const hex = await this.kv!.get(k).catch(() => '');
    const val = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    this.logger.debug(
      `getContractStorage(${_address}) slot=0x${slot} → ${val.byteLength} bytes`,
    );
    return val;
  }

  /**
   * 컨트랙트 스토리지 저장 (간이 루트 갱신: storageRoot = keccak(prevRoot || 0x00 || keccak(address||slot||value)))
   */
  async putContractStorage(
    _address: Address,
    _key: Uint8Array,
    _value: Uint8Array,
  ): Promise<void> {
    await this.ensureDB();
    const address = _address.toLowerCase();
    const slot = Buffer.from(_key).toString('hex');
    const k = `storage:${address}:${slot}`;
    await this.kv!.put(k, Buffer.from(_value).toString('hex'));

    // storageRoot 간이 갱신
    const acc =
      (await this.stateManager.getAccount(address)) || new Account(address);
    const prevRootBytes =
      acc.storageRoot && acc.storageRoot !== EMPTY_ROOT
        ? Buffer.from(this.crypto.hexToBytes(acc.storageRoot))
        : Buffer.alloc(0);
    const mix = Buffer.concat([
      Buffer.from(address.replace(/^0x/, ''), 'hex'),
      Buffer.from(slot, 'hex'),
      Buffer.from(_value),
    ]);
    const delta = Buffer.from(this.crypto.hashBuffer(mix).slice(2), 'hex');
    const combined = Buffer.concat([prevRootBytes, delta]);
    const newRoot = this.crypto.hashBuffer(combined);
    acc.storageRoot = newRoot;
    await this.stateManager.setAccount(address, acc);

    this.logger.debug(
      `putContractStorage(${_address}) slot=0x${slot} ← ${_value.byteLength} bytes, storageRoot=${newRoot}`,
    );
  }

  /**
   * 우리 Account → @ethereumjs Account 변환
   * VM 내부 계정 타입을 맞추기 위해 변환이 필요함
   */
  private toEthAccount(our: Account): EthAccount {
    return createAccount({
      nonce: BigInt(our.nonce),
      balance: our.balance,
      storageRoot: this.crypto.hexToBytes(our.storageRoot || EMPTY_ROOT),
      codeHash: this.crypto.hexToBytes(our.codeHash || EMPTY_HASH),
    });
  }

  /**
   * @ethereumjs Account → 우리 Account 변환
   */
  private toOurAccount(address: Address, eth: EthAccount): Account {
    const acc = new Account(address);
    // @ethereumjs Account의 getter는 bigint 반환
    // nonce는 number 범위를 가정 (우리 구현 기준)
    acc.nonce = Number(eth.nonce ?? 0n);
    acc.balance = eth.balance ?? 0n;
    // storageRoot/codeHash는 유지 (EVM이 수정 시 별도 경로에서 갱신)
    return acc;
  }
}
