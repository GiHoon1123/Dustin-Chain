import { Injectable, Logger } from '@nestjs/common';
import { Address } from '../common/types/common.types';
import { StateManager } from '../state/state-manager';
import { IStateRepository } from '../storage/repositories/state.repository.interface';
import { Account } from './entities/account.entity';

/**
 * Account Service
 *
 * 역할:
 * - 계정 생성 및 조회
 * - 잔액 관리 (송금, 수령)
 * - Nonce 관리 (트랜잭션 순서)
 * - 스테이킹 관리 (POS)
 *
 * 이더리움에서:
 * - StateDB가 비슷한 역할
 * - 모든 계정 상태 관리
 * - 트랜잭션 실행 시 상태 변경
 *
 * 변경사항 (State Trie 도입):
 * - IAccountRepository → IStateRepository 사용
 * - StateManager는 트랜잭션 실행 중 임시 상태 관리
 * - IStateRepository는 영구 저장소 (LevelDB + Trie)
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly stateRepository: IStateRepository,
    private readonly stateManager: StateManager,
  ) {}

  /**
   * 계정 조회 (없으면 생성)
   *
   * 이더리움 동작:
   * - 처음 트랜잭션 받으면 자동 생성
   * - 초기 상태: balance=0, nonce=0
   *
   * @param address - 계정 주소
   * @returns Account
   */
  async getOrCreateAccount(address: Address): Promise<Account> {
    let account = await this.stateManager.getAccount(address);

    if (!account) {
      account = new Account(address);
      this.stateManager.setAccount(address, account);
      // this.logger.log(`Created new account: ${address}`);
    }

    return account;
  }

  /**
   * 계정 조회 (없으면 null)
   *
   * @param address - 계정 주소
   * @returns Account 또는 null
   */
  async getAccount(address: Address): Promise<Account | null> {
    return this.stateManager.getAccount(address);
  }

  /**
   * 잔액 조회
   *
   * @param address - 계정 주소
   * @returns 잔액 (Wei 단위), 계정 없으면 0
   */
  async getBalance(address: Address): Promise<bigint> {
    const account = await this.stateManager.getAccount(address);
    return account ? account.balance : 0n;
  }

  /**
   * Nonce 조회
   *
   * @param address - 계정 주소
   * @returns nonce, 계정 없으면 0
   */
  async getNonce(address: Address): Promise<number> {
    const account = await this.stateManager.getAccount(address);
    return account ? account.nonce : 0;
  }

  /**
   * 잔액 추가
   *
   * 용도:
   * - 트랜잭션 수령
   * - 블록 보상
   * - Genesis 초기화
   *
   * Service 역할:
   * - StateManager에서 계정 조회
   * - Entity의 비즈니스 로직 호출
   * - 변경사항을 StateManager에 저장 (저널에 기록)
   *
   * @param address - 계정 주소
   * @param amount - 추가할 금액 (Wei)
   * @throws {Error} Entity에서 비즈니스 규칙 위반 시
   */
  async addBalance(address: Address, amount: bigint): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 규칙 검증 (양수 체크)
    account.addBalance(amount);

    // StateManager에 변경사항 저장 (저널에 기록)
    this.stateManager.setAccount(address, account);

    // this.logger.log(
    //   `Added ${amount} Wei to ${address}, new balance: ${account.balance}`,
    // );
  }

  /**
   * 잔액 차감
   *
   * 용도:
   * - 트랜잭션 전송
   * - 스테이킹
   * - 수수료 지불
   *
   * Service 역할:
   * - StateManager에서 계정 조회
   * - Entity의 비즈니스 로직 호출
   * - 변경사항을 StateManager에 저장 (저널에 기록)
   *
   * @param address - 계정 주소
   * @param amount - 차감할 금액 (Wei)
   * @throws {Error} Entity에서 비즈니스 규칙 위반 시 (잔액 부족 등)
   */
  async subtractBalance(address: Address, amount: bigint): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 규칙 검증 (양수 체크 + 잔액 부족 체크)
    account.subtractBalance(amount);

    // StateManager에 변경사항 저장 (저널에 기록)
    this.stateManager.setAccount(address, account);

    // this.logger.log(
    //   `Subtracted ${amount} Wei from ${address}, new balance: ${account.balance}`,
    // );
  }

  /**
   * 송금 (A → B)
   *
   * 이더리움 동작:
   * 1. 발신자 잔액 확인
   * 2. 발신자 잔액 차감
   * 3. 수신자 잔액 증가
   * 4. Atomic operation (둘 다 성공 or 둘 다 실패)
   *
   * @param from - 발신자
   * @param to - 수신자
   * @param amount - 금액 (Wei)
   */
  async transfer(from: Address, to: Address, amount: bigint): Promise<void> {
    if (amount <= 0n) {
      throw new Error('Transfer amount must be positive');
    }

    if (from.toLowerCase() === to.toLowerCase()) {
      throw new Error('Cannot transfer to yourself');
    }

    // 트랜잭션처럼 원자적 실행
    await this.subtractBalance(from, amount);
    await this.addBalance(to, amount);

    // this.logger.log(`Transferred ${amount} Wei from ${from} to ${to}`);
  }

  /**
   * Nonce 증가
   *
   * 이더리움 동작:
   * - 트랜잭션 실행 후 nonce++
   * - 순서 보장
   *
   * Service 역할:
   * - StateManager에서 계정 조회
   * - Entity의 비즈니스 로직 호출
   * - 변경사항을 StateManager에 저장 (저널에 기록)
   *
   * @param address - 계정 주소
   */
  async incrementNonce(address: Address): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 로직 실행
    account.incrementNonce();

    // StateManager에 변경사항 저장 (저널에 기록)
    this.stateManager.setAccount(address, account);

    // this.logger.log(`Incremented nonce for ${address}: ${account.nonce}`);
  }

  /**
   * 모든 계정 조회
   *
   * 용도:
   * - 관리자 페이지
   * - 디버깅
   *
   * 주의:
   * - State Trie는 전체 조회를 지원하지 않음 (해시 기반)
   * - 이더리움도 마찬가지 (전체 계정 조회 불가)
   * - 필요하다면 별도 인덱스 구축 필요 (Secure Key)
   *
   * 현재 구현:
   * - StateManager의 메모리 상태만 반환
   * - 실제 LevelDB의 모든 계정은 조회 불가
   */
  async getAllAccounts(): Promise<Account[]> {
    // StateManager는 현재 메모리에 있는 계정만 반환
    // 실제 이더리움에서는 이런 API가 없음 (해시 기반이라 불가능)
    this.logger.warn(
      'getAllAccounts: Only returns accounts in memory (StateManager)',
    );
    return [];
  }

  /**
   * 계정 존재 확인
   */
  async exists(address: Address): Promise<boolean> {
    const account = await this.stateManager.getAccount(address);
    return account !== null;
  }
}
