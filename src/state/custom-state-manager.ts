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
      try {
        const opts: any = { keyEncoding: 'utf8', valueEncoding: 'utf8' };
        // StateLevelDBRepository와 다른 경로 사용 (컨트랙트 코드/스토리지 전용)
        const db = new ClassicLevel<string, string>('data/contracts', opts);
        await db.open();
        this.kv = db;
        // this.logger.log('CustomStateManager KV opened (data/state)');
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to open KV database: ${errorMsg}`);
        // 이미 열려있거나 다른 프로세스가 사용 중일 수 있음
        // 에러를 throw하지 않고 계속 진행 (코드 조회 시 빈 값 반환)
      }
    }
  }

  /**
   * Address 타입 정규화 (VM 10.x 호환)
   * VM이 Uint8Array나 다른 타입의 Address를 전달할 수 있음
   * @ethereumjs/common의 Address 타입은 string이거나 특별한 객체일 수 있음
   */
  private normalizeAddress(address: Address | Uint8Array | unknown): Address {
    if (typeof address === 'string') {
      return address;
    }
    if (address instanceof Uint8Array) {
      return this.crypto.bytesToHex(address);
    }
    if (Buffer.isBuffer(address)) {
      return this.crypto.bytesToHex(address);
    }
    // @ethereumjs/common의 Address 객체일 수 있음 (toString() 메서드 확인)
    if (address && typeof address === 'object' && 'toString' in address) {
      const addrStr = (address as { toString: () => string }).toString();
      // 0x 접두사가 없으면 추가
      return addrStr.startsWith('0x') ? addrStr : `0x${addrStr}`;
    }
    // 기타 타입도 string으로 변환 시도
    const addrStr = String(address);
    return addrStr.startsWith('0x') ? addrStr : `0x${addrStr}`;
  }

  /**
   * EVM이 기대하는 형태로 계정 조회
   * - 우리 Account → @ethereumjs/util.Account 변환
   */
  async getAccount(address: Address | Uint8Array): Promise<EthAccount> {
    const normalizedAddr = this.normalizeAddress(address);
    // this.logger.debug(`getAccount(${normalizedAddr})`);
    const our = await this.stateManager.getAccount(normalizedAddr);
    if (!our) {
      // 존재하지 않는 계정은 nonce=0, balance=0, 빈 storage/code로 반환
      // this.logger.debug(`getAccount(${address}) → not found, returning empty`);
      // hexToBytes는 Uint8Array를 반환하지만, 명시적으로 순수 Uint8Array 복제본으로 보장
      const storageRootBytesRaw = this.crypto.hexToBytes(EMPTY_ROOT);
      const codeHashBytesRaw = this.crypto.hexToBytes(EMPTY_HASH);

      // 순수 Uint8Array 복제본 생성 (Buffer가 아닌)
      const storageRootBytes =
        storageRootBytesRaw instanceof Uint8Array
          ? new Uint8Array(storageRootBytesRaw) // 복제본 생성
          : new Uint8Array(storageRootBytesRaw);
      const codeHashBytes =
        codeHashBytesRaw instanceof Uint8Array
          ? new Uint8Array(codeHashBytesRaw) // 복제본 생성
          : new Uint8Array(codeHashBytesRaw);

      return createAccount({
        nonce: 0n,
        balance: 0n,
        storageRoot: storageRootBytes,
        codeHash: codeHashBytes,
      });
    }
    // this.logger.debug(
    //   `getAccount(${address}) → nonce=${our.nonce}, balance=${our.balance}`,
    // );
    return this.toEthAccount(our);
  }

  /**
   * EVM이 수정한 계정 저장
   * - @ethereumjs/util.Account → 우리 Account 변환 후 저널에 기록
   */
  async putAccount(
    address: Address | Uint8Array,
    eth: EthAccount,
  ): Promise<void> {
    const normalizedAddr = this.normalizeAddress(address);
    const our = this.toOurAccount(normalizedAddr, eth);
    await this.stateManager.setAccount(normalizedAddr, our);
    // this.logger.debug(
    //   `putAccount(${address}) nonce=${our.nonce}, balance=${our.balance}`,
    // );
  }

  /**
   * 체크포인트/커밋/리버트는 우리 StateManager 저널 스택과 매핑
   *
   * 이더리움과 동일하게 동작:
   * - checkpoint: 스택에 새 레벨 push (중첩 가능)
   * - commit: 최상단 pop 후 하위 레벨에 병합
   * - revert: 최상단 pop만 (변경사항 취소)
   */
  async checkpoint(): Promise<void> {
    await this.stateManager.checkpoint();
    // this.logger.debug(`checkpoint() - depth: ${(this.stateManager as any).journalStack?.length || 'unknown'}`);
  }

  async commit(): Promise<void> {
    await this.stateManager.commitCheckpoint();
    // this.logger.debug(`commit() - depth: ${(this.stateManager as any).journalStack?.length || 'unknown'}`);
  }

  async revert(): Promise<void> {
    await this.stateManager.revertCheckpoint();
    // this.logger.debug(`revert() - depth: ${(this.stateManager as any).journalStack?.length || 'unknown'}`);
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
    // this.logger.debug('flush() called (no-op)');
  }

  /**
   * StateManagerInterface 10.x 호환 메서드들
   */
  async deleteAccount(address: Address | Uint8Array): Promise<void> {
    const normalizedAddr = this.normalizeAddress(address);
    await this.stateManager.setAccount(
      normalizedAddr,
      new Account(normalizedAddr),
    );
    // this.logger.debug(`deleteAccount(${normalizedAddr})`);
  }

  async modifyAccountFields(
    address: Address | Uint8Array,
    accountFields: {
      nonce?: bigint;
      balance?: bigint;
      storageRoot?: Uint8Array;
      codeHash?: Uint8Array;
    },
  ): Promise<void> {
    const normalizedAddr = this.normalizeAddress(address);
    const acc =
      (await this.stateManager.getAccount(normalizedAddr)) ||
      new Account(normalizedAddr);
    if (accountFields.nonce !== undefined) {
      acc.nonce = Number(accountFields.nonce);
    }
    if (accountFields.balance !== undefined) {
      acc.balance = accountFields.balance;
    }
    if (accountFields.storageRoot !== undefined) {
      // Uint8Array인지 확인하고 변환
      const storageRootBuf =
        accountFields.storageRoot instanceof Uint8Array
          ? accountFields.storageRoot
          : Buffer.from(
              accountFields.storageRoot as unknown as ArrayLike<number>,
            );
      acc.storageRoot = this.crypto.bytesToHex(storageRootBuf);
    }
    if (accountFields.codeHash !== undefined) {
      // Uint8Array인지 확인하고 변환
      const codeHashBuf =
        accountFields.codeHash instanceof Uint8Array
          ? accountFields.codeHash
          : Buffer.from(accountFields.codeHash as unknown as ArrayLike<number>);
      acc.codeHash = this.crypto.bytesToHex(codeHashBuf);
    }
    await this.stateManager.setAccount(normalizedAddr, acc);
    // this.logger.debug(`modifyAccountFields(${normalizedAddr})`);
  }

  async putCode(
    address: Address | Uint8Array,
    value: Uint8Array,
  ): Promise<void> {
    const normalizedAddr = this.normalizeAddress(address);
    await this.putContractCode(normalizedAddr, value);
  }

  /**
   * getCode 오버라이드
   *
   * ⚠️ 중요: 기본 구현이 실행되지 않도록 명시적으로 오버라이드
   * 기본 구현은 LevelDB에서 Buffer를 반환할 수 있어서 에러 발생 가능
   */
  async getCode(address: Address | Uint8Array): Promise<Uint8Array> {
    const normalizedAddr = this.normalizeAddress(address);
    const code = await this.getContractCode(normalizedAddr);

    // ⚠️ 이중 보장: getContractCode가 이미 Uint8Array를 반환하지만, 다시 한번 확인
    // Buffer가 아닌 순수 Uint8Array 복제본으로 반환
    if (code instanceof Uint8Array && code.constructor.name === 'Uint8Array') {
      return code;
    }
    // 만약 Buffer나 다른 타입이면 Uint8Array로 변환
    return new Uint8Array(code);
  }

  async getCodeSize(address: Address | Uint8Array): Promise<number> {
    const normalizedAddr = this.normalizeAddress(address);
    const code = await this.getContractCode(normalizedAddr);
    return code.length;
  }

  async clearStorage(address: Address | Uint8Array): Promise<void> {
    await this.ensureDB();
    const normalizedAddr = this.normalizeAddress(address);
    const addressLower = normalizedAddr.toLowerCase();
    // 모든 스토리지 슬롯 삭제 (간단한 구현)
    // 실제로는 키를 순회하면서 삭제해야 하지만, 현재는 빈 구현
    // this.logger.debug(`clearStorage(${address})`);
  }

  async getStateRoot(): Promise<Uint8Array> {
    const root = await this.stateRepository.getStateRoot();
    const rootBytes = this.crypto.hexToBytes(root);
    // ⚠️ 중요: hexToBytes는 이미 Uint8Array를 반환하지만, 확실히 하기 위해 복제본 생성
    return new Uint8Array(rootBytes);
  }

  async setStateRoot(
    stateRoot: Uint8Array,
    clearCache?: boolean,
  ): Promise<void> {
    // Uint8Array인지 확인하고 변환
    const rootBuf =
      stateRoot instanceof Uint8Array
        ? stateRoot
        : Buffer.from(stateRoot as unknown as ArrayLike<number>);
    const rootHex = this.crypto.bytesToHex(rootBuf);
    await this.stateRepository.setStateRoot(rootHex);
    if (clearCache) {
      // 캐시 클리어는 StateManager에서 처리
    }
    // this.logger.debug(`setStateRoot(${rootHex})`);
  }

  async hasStateRoot(root: Uint8Array): Promise<boolean> {
    const currentRoot = await this.getStateRoot();
    // Uint8Array인지 확인하고 변환
    const rootBuf =
      root instanceof Uint8Array
        ? root
        : Buffer.from(root as unknown as ArrayLike<number>);
    return Buffer.from(rootBuf).equals(Buffer.from(currentRoot));
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
    // this.logger.debug('clearCaches()');
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
    const bytesBuffer = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    // ⚠️ 중요: Buffer를 Uint8Array로 변환하여 반환
    const bytes = new Uint8Array(bytesBuffer);
    // this.logger.debug(
    //   `getContractCode(${_address}) → ${bytes.byteLength} bytes (key=${key})`,
    // );
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
    // this.logger.debug(
    //   `putContractCode(${_address}) ← ${_code.byteLength} bytes (codeHash=${codeHash})`,
    // );
  }

  async getStorage(
    address: Address | Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    const normalizedAddr = this.normalizeAddress(address);
    return this.getContractStorage(normalizedAddr, key);
  }

  async putStorage(
    address: Address | Uint8Array,
    key: Uint8Array,
    value: Uint8Array,
  ): Promise<void> {
    const normalizedAddr = this.normalizeAddress(address);
    return this.putContractStorage(normalizedAddr, key, value);
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
    const valBuffer = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
    // ⚠️ 중요: Buffer를 Uint8Array로 변환하여 반환
    const val = new Uint8Array(valBuffer);
    // this.logger.debug(
    //   `getContractStorage(${_address}) slot=0x${slot} → ${val.byteLength} bytes`,
    // );
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

    // this.logger.debug(
    //   `putContractStorage(${_address}) slot=0x${slot} ← ${_value.byteLength} bytes, storageRoot=${newRoot}`,
    // );
  }

  /**
   * 우리 Account → @ethereumjs Account 변환
   * VM 내부 계정 타입을 맞추기 위해 변환이 필요함
   */
  private toEthAccount(our: Account): EthAccount {
    // storageRoot와 codeHash는 반드시 string이어야 함
    const storageRootStr =
      typeof our.storageRoot === 'string'
        ? our.storageRoot
        : our.storageRoot || EMPTY_ROOT;
    const codeHashStr =
      typeof our.codeHash === 'string'
        ? our.codeHash
        : our.codeHash || EMPTY_HASH;

    // ⚠️ VM 버그 수정을 위해 주소 생성 전에만 nonce를 조정하는 방법이 필요함
    // 하지만 getAccount는 주소 생성뿐 아니라 nonce 검증에도 사용됨
    // 따라서 원래 nonce를 반환하고, 주소 생성 시에만 특별 처리 필요
    // 하지만 VM 코드를 수정할 수 없으므로, 일단 원래 nonce 반환
    // TODO: VM의 _generateAddress를 패치하거나 다른 방법 필요

    // hexToBytes는 Uint8Array를 반환하지만, 명시적으로 순수 Uint8Array 복제본으로 보장
    const storageRootBytesRaw = this.crypto.hexToBytes(storageRootStr);
    const codeHashBytesRaw = this.crypto.hexToBytes(codeHashStr);

    // 순수 Uint8Array 복제본 생성 (Buffer가 아닌)
    const storageRootBytes =
      storageRootBytesRaw instanceof Uint8Array
        ? new Uint8Array(storageRootBytesRaw) // 복제본 생성
        : new Uint8Array(storageRootBytesRaw);
    const codeHashBytes =
      codeHashBytesRaw instanceof Uint8Array
        ? new Uint8Array(codeHashBytesRaw) // 복제본 생성
        : new Uint8Array(codeHashBytesRaw);

    // createAccount 호출 전에 타입 확인
    const account = createAccount({
      nonce: BigInt(our.nonce),
      balance: our.balance,
      storageRoot: storageRootBytes,
      codeHash: codeHashBytes,
    });

    // ⚠️ 확인: createAccount가 내부적으로 Buffer를 다시 만들지 않는지 검증
    if (
      account.storageRoot &&
      account.storageRoot.constructor.name !== 'Uint8Array'
    ) {
      this.logger.warn(
        `[WARN] createAccount returned storageRoot as ${account.storageRoot.constructor.name}, expected Uint8Array`,
      );
    }
    if (
      account.codeHash &&
      account.codeHash.constructor.name !== 'Uint8Array'
    ) {
      this.logger.warn(
        `[WARN] createAccount returned codeHash as ${account.codeHash.constructor.name}, expected Uint8Array`,
      );
    }

    return account;
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
