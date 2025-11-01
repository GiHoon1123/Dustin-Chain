import { Account as EthAccount, createAccount } from '@ethereumjs/util';
import { DefaultStateManager } from '@ethereumjs/statemanager';
import { Injectable } from '@nestjs/common';
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
export class CustomStateManager extends DefaultStateManager {
  // 임시 저장 (DB 연동 전 과도기)
  private codeKV: Map<string, Uint8Array> = new Map();
  private storageKV: Map<string, Uint8Array> = new Map();

  constructor(
    private readonly stateManager: StateManager,
    private readonly stateRepository: IStateRepository,
    private readonly crypto: CryptoService,
  ) {
    super();
  }

  /**
   * EVM이 기대하는 형태로 계정 조회
   * - 우리 Account → @ethereumjs/util.Account 변환
   */
  async getAccount(address: Address): Promise<EthAccount> {
    const our = await this.stateManager.getAccount(address);
    if (!our) {
      // 존재하지 않는 계정은 nonce=0, balance=0, 빈 storage/code로 반환
      return createAccount({
        nonce: 0n,
        balance: 0n,
        storageRoot: this.crypto.hexToBytes(EMPTY_ROOT),
        codeHash: this.crypto.hexToBytes(EMPTY_HASH),
      });
    }
    return this.toEthAccount(our);
  }

  /**
   * EVM이 수정한 계정 저장
   * - @ethereumjs/util.Account → 우리 Account 변환 후 저널에 기록
   */
  async putAccount(address: Address, eth: EthAccount): Promise<void> {
    const our = this.toOurAccount(address, eth);
    await this.stateManager.setAccount(address, our);
  }

  /**
   * EVM 체크포인트 시작 → 저널 시작과 매핑
   */
  async checkpoint(): Promise<void> {
    await super.checkpoint();
    await this.stateManager.startBlock();
  }

  /**
   * EVM 커밋 → 저널 커밋과 매핑 (Trie/LevelDB 반영)
   */
  async commit(): Promise<void> {
    await super.commit();
    await this.stateManager.commitBlock();
  }

  /**
   * EVM 리버트 → 저널 롤백과 매핑
   */
  async revert(): Promise<void> {
    await super.revert();
    await this.stateManager.rollbackBlock();
  }

  /**
   * 컨트랙트 코드 조회 (최소 구현: 없으면 빈 코드)
   */
  async getContractCode(_address: Address): Promise<Uint8Array> {
    // TODO: DB 연동 (code:codeHash)
    // 현재 단계: 주소 기반 임시 네임스페이스
    const key = `code:${_address.toLowerCase()}`;
    return this.codeKV.get(key) ?? new Uint8Array();
  }

  /**
   * 컨트랙트 코드 저장 (최소 구현: no-op)
   */
  async putContractCode(_address: Address, _code: Uint8Array): Promise<void> {
    // TODO: codeHash = keccak(code) 계산 후 DB 저장 및 계정 codeHash 갱신
    const key = `code:${_address.toLowerCase()}`;
    this.codeKV.set(key, _code);
  }

  /**
   * 컨트랙트 스토리지 조회 (최소 구현: 없으면 0)
   */
  async getContractStorage(
    _address: Address,
    _key: Uint8Array,
  ): Promise<Uint8Array> {
    // TODO: storageRoot 기반 트라이 연동
    const slot = Buffer.from(_key).toString('hex');
    const k = `storage:${_address.toLowerCase()}:${slot}`;
    return this.storageKV.get(k) ?? new Uint8Array();
  }

  /**
   * 컨트랙트 스토리지 저장 (최소 구현: no-op)
   */
  async putContractStorage(
    _address: Address,
    _key: Uint8Array,
    _value: Uint8Array,
  ): Promise<void> {
    // TODO: storage 트라이 및 storageRoot 반영
    const slot = Buffer.from(_key).toString('hex');
    const k = `storage:${_address.toLowerCase()}:${slot}`;
    this.storageKV.set(k, _value);
  }

  /**
   * 우리 Account → @ethereumjs Account 변환
   * VM 내부 계정 타입을 맞추기 위해 변환이 필요함
   */
  private toEthAccount(our: Account): EthAccount {
    return createAccount({
      nonce: BigInt(our.nonce),
      balance: our.balance,
      storageRoot: this.crypto.hexToBytes(EMPTY_ROOT),
      codeHash: this.crypto.hexToBytes(EMPTY_HASH),
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
    return acc;
  }
}
