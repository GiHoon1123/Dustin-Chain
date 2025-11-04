import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { COMMITTEE_SIZE } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { Validator } from './entities/validator.entity';

interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Validator Service
 *
 * 역할:
 * - Genesis Validator 생성 (256개 하드코딩)
 * - Proposer 선택 (슬롯마다 1명)
 * - Committee 선택 (슬롯마다 128명)
 * - 블록 검증
 *
 * 이더리움:
 * - 900,000+ Validator
 * - Committee: 128명
 * - Slot: 12초
 * - Epoch: 32 slots = 6.4분
 *
 * 우리:
 * - 256 Genesis Validator (테스트용)
 * - Committee: 128명 (이더리움과 동일)
 * - Slot: 12초 (이더리움과 동일)
 */
@Injectable()
export class ValidatorService {
  private readonly logger = new Logger(ValidatorService.name);

  /**
   * Genesis Validators (256개)
   *
   * 이더리움 Committee 크기: 128명
   * 우리: 256명 (2배) - Committee 선택 알고리즘 테스트용
   */
  private readonly genesisValidators: Validator[] = [];

  constructor(private readonly cryptoService: CryptoService) {
    this.initializeGenesisValidators();
  }

  /**
   * Genesis Validators 초기화
   *
   * genesis-accounts.json에서 256개 계정 로드
   */
  private initializeGenesisValidators(): void {
    try {
      const accountsPath = this.findAccountsFile();

      if (!accountsPath) {
        this.logger.warn('genesis-accounts.json not found, using fallback');
        this.useFallbackValidators();
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const accounts: GenesisAccount[] = JSON.parse(fileContent);

      for (const account of accounts) {
        const validator = new Validator(account.address);
        this.genesisValidators.push(validator);
      }

      // this.logger.log(
      //   `Initialized ${this.genesisValidators.length} Genesis Validators from genesis-accounts.json`,
      // );
    } catch (error) {
      this.logger.error(
        `Failed to load genesis-accounts.json: ${error.message}`,
      );
      this.useFallbackValidators();
    }
  }

  private findAccountsFile(): string | null {
    const possiblePaths = [
      path.resolve(process.cwd(), 'genesis-accounts.json'),
      path.resolve(__dirname, '../../genesis-accounts.json'),
      path.resolve(__dirname, '../../../genesis-accounts.json'),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  private useFallbackValidators(): void {
    for (let i = 1; i <= 256; i++) {
      const address = '0x' + i.toString(16).padStart(40, '0');
      const validator = new Validator(address);
      this.genesisValidators.push(validator);
    }

    // this.logger.log(
    //   `Initialized ${this.genesisValidators.length} Fallback Validators`,
    // );
  }

  /**
   * 모든 Validator 조회
   */
  async getAllValidators(): Promise<Validator[]> {
    return this.genesisValidators.filter((v) => v.isActive);
  }

  /**
   * 활성 Validator 개수
   */
  async getActiveCount(): Promise<number> {
    return this.genesisValidators.filter((v) => v.isActive).length;
  }

  /**
   * Proposer 선택 (슬롯마다 1명)
   *
   * 이더리움:
   * - RANDAO 기반 의사 난수
   * - 스테이킹 가중치 반영 (나중에)
   *
   * 현재:
   * - Slot 기반 결정적 선택
   * - 256명 중 1명
   *
   * @param slot - 슬롯 번호
   * @returns Proposer 주소
   */
  async selectProposer(slot: number): Promise<Address> {
    const validators = await this.getAllValidators();

    if (validators.length === 0) {
      throw new Error('No active validators');
    }

    // RANDAO seed 생성 (Proposer용)
    const seed = this.generateSeed(slot, 'proposer');

    // 결정적 무작위 선택
    const index = Number(
      BigInt('0x' + seed.slice(2, 18)) % BigInt(validators.length),
    );

    const proposer = validators[index];

    // this.logger.debug(
    //   `Slot ${slot}: Selected Proposer ${proposer.address.slice(0, 10)}... (index: ${index}/${validators.length})`,
    // );

    return proposer.address;
  }

  /**
   * Committee 선택 (슬롯마다 128명)
   *
   * 이더리움:
   * - 각 슬롯마다 128명의 검증자 선택
   * - 블록 증명(Attestation) 제출
   * - 2/3 이상이면 블록 확정
   *
   * 알고리즘:
   * - Fisher-Yates Shuffle (결정적)
   * - Slot 기반 시드
   * - 상위 128명 선택
   *
   * @param slot - 슬롯 번호
   * @returns Committee 주소 배열 (128명)
   */
  async selectCommittee(slot: number): Promise<Address[]> {
    const validators = await this.getAllValidators();

    if (validators.length < COMMITTEE_SIZE) {
      this.logger.warn(
        `Not enough validators (${validators.length}) for full committee (${COMMITTEE_SIZE})`,
      );
      return validators.map((v) => v.address);
    }

    // RANDAO seed 생성 (Committee용, Proposer와 다른 시드)
    const seed = this.generateSeed(slot, 'committee');

    // Fisher-Yates Shuffle (결정적)
    const shuffled = this.shuffle(validators, seed);

    // 상위 128명 선택
    const committee = shuffled.slice(0, COMMITTEE_SIZE).map((v) => v.address);

    // this.logger.debug(
    //   `Slot ${slot}: Selected Committee ${committee.length} validators`,
    // );

    return committee;
  }

  /**
   * Fisher-Yates Shuffle (Deterministic)
   *
   * 시드 기반 결정적 셔플
   * - 같은 시드 = 같은 결과
   * - 슬롯마다 다른 시드 = 다른 순서
   *
   * @param array - 셔플할 배열
   * @param seed - 시드 (해시)
   * @returns 셔플된 배열
   */
  private shuffle(array: Validator[], seed: string): Validator[] {
    const result = [...array];
    let currentSeed = BigInt('0x' + seed.slice(2));

    for (let i = result.length - 1; i > 0; i--) {
      // LCG (Linear Congruential Generator)
      // 시드 기반 의사 난수 생성
      currentSeed = (currentSeed * 48271n) % 2147483647n;
      const j = Number(currentSeed % BigInt(i + 1));

      // Swap
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  /**
   * RANDAO Seed 생성
   *
   * 이더리움:
   * - 이전 블록들의 RANDAO reveal 조합
   * - 미리 예측 불가능
   *
   * 현재 (간단 버전):
   * - Slot과 용도를 조합해서 해시
   * - Proposer와 Committee가 다른 시드 사용
   *
   * @param slot - 슬롯 번호
   * @param purpose - 용도 ('proposer' or 'committee')
   * @returns 32 bytes 해시
   */
  private generateSeed(slot: number, purpose: string): string {
    return this.cryptoService.hashUtf8(`randao-${slot}-${purpose}`);
  }

  /**
   * Validator 통계
   */
  async getStats() {
    const total = this.genesisValidators.length;
    const active = this.genesisValidators.filter((v) => v.isActive).length;

    return {
      total,
      active,
      inactive: total - active,
      committeeSize: COMMITTEE_SIZE,
    };
  }
}
