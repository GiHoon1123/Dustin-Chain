import { Injectable, Logger } from '@nestjs/common';
import { Address } from '../common/types/common.types';
import { Account } from './entities/account.entity';
import { IAccountRepository } from './repositories/account.repository.interface';

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
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly repository: IAccountRepository) {}

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
    let account = await this.repository.findByAddress(address);

    if (!account) {
      account = new Account(address);
      await this.repository.save(account);
      this.logger.log(`Created new account: ${address}`);
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
    return this.repository.findByAddress(address);
  }

  /**
   * 잔액 조회
   *
   * @param address - 계정 주소
   * @returns 잔액 (Wei 단위), 계정 없으면 0
   */
  async getBalance(address: Address): Promise<bigint> {
    const account = await this.repository.findByAddress(address);
    return account ? account.balance : 0n;
  }

  /**
   * Nonce 조회
   *
   * @param address - 계정 주소
   * @returns nonce, 계정 없으면 0
   */
  async getNonce(address: Address): Promise<number> {
    const account = await this.repository.findByAddress(address);
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
   * - Repository에서 계정 조회 (외부 인프라)
   * - Entity의 비즈니스 로직 호출
   * - 변경사항 저장 (외부 인프라)
   *
   * @param address - 계정 주소
   * @param amount - 추가할 금액 (Wei)
   * @throws {Error} Entity에서 비즈니스 규칙 위반 시
   */
  async addBalance(address: Address, amount: bigint): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 규칙 검증 (양수 체크)
    account.addBalance(amount);

    await this.repository.save(account);

    this.logger.debug(
      `Added ${amount} Wei to ${address}, new balance: ${account.balance}`,
    );
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
   * - Repository에서 계정 조회
   * - Entity의 비즈니스 로직 호출
   * - 변경사항 저장
   *
   * @param address - 계정 주소
   * @param amount - 차감할 금액 (Wei)
   * @throws {Error} Entity에서 비즈니스 규칙 위반 시 (잔액 부족 등)
   */
  async subtractBalance(address: Address, amount: bigint): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 규칙 검증 (양수 체크 + 잔액 부족 체크)
    account.subtractBalance(amount);

    await this.repository.save(account);

    this.logger.debug(
      `Subtracted ${amount} Wei from ${address}, new balance: ${account.balance}`,
    );
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

    this.logger.log(`Transferred ${amount} Wei from ${from} to ${to}`);
  }

  /**
   * Nonce 증가
   *
   * 이더리움 동작:
   * - 트랜잭션 실행 후 nonce++
   * - 순서 보장
   *
   * Service 역할:
   * - Repository에서 계정 조회
   * - Entity의 비즈니스 로직 호출
   * - 변경사항 저장
   *
   * @param address - 계정 주소
   */
  async incrementNonce(address: Address): Promise<void> {
    const account = await this.getOrCreateAccount(address);

    // Entity에서 비즈니스 로직 실행
    account.incrementNonce();

    await this.repository.save(account);

    this.logger.debug(`Incremented nonce for ${address}: ${account.nonce}`);
  }

  /**
   * 모든 계정 조회
   *
   * 용도:
   * - 관리자 페이지
   * - 디버깅
   */
  async getAllAccounts(): Promise<Account[]> {
    return this.repository.findAll();
  }

  /**
   * 계정 존재 확인
   */
  async exists(address: Address): Promise<boolean> {
    return this.repository.exists(address);
  }
}
