import { Injectable } from '@nestjs/common';
import { Address } from '../../common/types/common.types';
import { Account } from '../entities/account.entity';
import { IAccountRepository } from './account.repository.interface';

/**
 * In-Memory Account Repository
 *
 * 현재 구현:
 * - Map<Address, Account>로 메모리에 저장
 * - 빠른 개발 및 테스트
 * - 서버 재시작 시 데이터 소실
 *
 * 장점:
 * - 매우 빠름
 * - 구현 간단
 * - 테스트 쉬움
 *
 * 단점:
 * - 재시작하면 날아감
 * - 대용량 처리 불가
 * - 프로덕션 부적합
 *
 * 나중에 교체:
 * - LevelDB (이더리움 Geth와 동일)
 * - 인터페이스 동일하므로 Service 변경 불필요
 */
@Injectable()
export class AccountMemoryRepository implements IAccountRepository {
  /**
   * 계정 저장소 (In-Memory)
   *
   * Map 사용 이유:
   * - O(1) 조회 속도
   * - Key-Value 구조 (Address → Account)
   * - LevelDB와 유사한 구조
   */
  private readonly accounts: Map<Address, Account>;

  constructor() {
    this.accounts = new Map();
  }

  /**
   * 계정 조회
   */
  async findByAddress(address: Address): Promise<Account | null> {
    const account = this.accounts.get(address.toLowerCase());
    return Promise.resolve(account || null);
  }

  /**
   * 계정 저장
   *
   * 주의:
   * - address를 소문자로 정규화 (대소문자 구분 안함)
   * - 이더리움도 주소는 case-insensitive
   */
  async save(account: Account): Promise<void> {
    const normalizedAddress = account.address.toLowerCase();
    this.accounts.set(normalizedAddress, account);
    return Promise.resolve();
  }

  /**
   * 계정 존재 확인
   */
  async exists(address: Address): Promise<boolean> {
    return Promise.resolve(this.accounts.has(address.toLowerCase()));
  }

  /**
   * 모든 계정 조회
   */
  async findAll(): Promise<Account[]> {
    return Promise.resolve(Array.from(this.accounts.values()));
  }

  /**
   * 모든 계정 삭제
   *
   * 용도:
   * - 테스트 초기화
   * - Genesis 재시작
   */
  async clear(): Promise<void> {
    this.accounts.clear();
    return Promise.resolve();
  }

  /**
   * 통계 정보 (디버깅용)
   */
  getStats() {
    const allAccounts = Array.from(this.accounts.values());
    const totalBalance = allAccounts.reduce(
      (sum, acc) => sum + acc.balance,
      0n,
    );

    return {
      totalAccounts: this.accounts.size,
      totalBalance: totalBalance.toString(),
    };
  }
}
