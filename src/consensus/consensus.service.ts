import { Injectable, Logger } from '@nestjs/common';
import { Block } from '../block/entities/block.entity';
import {
  BLOCK_TIME,
  EPOCH_SIZE,
} from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Signature } from '../common/crypto/crypto.types';
import { Address } from '../common/types/common.types';
import { Attestation } from './entities/attestation.entity';

/**
 * Consensus Service
 *
 * 이더리움 POS 합의:
 * - Proposer가 블록 제안
 * - Committee가 블록 검증 (Attestation)
 * - 2/3 이상이면 블록 확정
 * - Epoch 단위로 Finality
 *
 * 역할:
 * - Attestation 수집
 * - Supermajority 확인 (2/3 이상)
 * - Epoch 관리
 * - Finality 처리 (나중에)
 */
@Injectable()
export class ConsensusService {
  private readonly logger = new Logger(ConsensusService.name);

  /**
   * Genesis Time (블록 생성 시작 시간)
   * BlockProducer에서 설정됨
   */
  private genesisTime: number | null = null;

  constructor(private readonly cryptoService: CryptoService) {}

  /**
   * Genesis Time 설정
   */
  setGenesisTime(timestamp: number): void {
    this.genesisTime = timestamp;
    this.logger.log(`Genesis Time set: ${new Date(timestamp).toISOString()}`);
  }

  /**
   * Committee로부터 Attestation 수집
   *
   * 이더리움:
   * - Committee 128명이 각자 블록 검증
   * - 서명한 Attestation 제출
   * - P2P로 수집 (Gossip)
   *
   * 현재 (간단 버전):
   * - 모든 Committee가 자동으로 검증
   * - 임시 서명 생성
   * - 나중에 실제 P2P 추가
   *
   * @param block - 검증할 블록
   * @param committee - 검증자 주소 배열
   * @returns Attestation 배열
   */
  async collectAttestations(
    block: Block,
    committee: Address[],
  ): Promise<Attestation[]> {
    const attestations: Attestation[] = [];
    const slot = this.getCurrentSlot();

    // 모든 Committee가 블록 검증
    for (const validator of committee) {
      // 블록 검증 (간단 버전)
      const isValid = await this.validateBlock(block);

      if (isValid) {
        // Attestation 서명 생성
        const signature = this.createAttestationSignature(validator, block);

        const attestation = new Attestation(
          slot,
          block.hash,
          validator,
          signature,
        );

        attestations.push(attestation);
      }
    }

    this.logger.log(
      `Collected ${attestations.length}/${committee.length} attestations for block #${block.number}`,
    );

    return attestations;
  }

  /**
   * Supermajority 확인 (2/3 이상)
   *
   * 이더리움:
   * - Committee의 2/3 이상이 검증해야 블록 확정
   * - 85/128 = 66.4%
   *
   * @param attestations - 수집된 Attestation
   * @param committeeSize - Committee 크기
   * @returns 2/3 이상인지 여부
   */
  hasSupermajority(
    attestations: Attestation[],
    committeeSize: number,
  ): boolean {
    const required = Math.ceil((committeeSize * 2) / 3);
    const hasSupermajority = attestations.length >= required;

    this.logger.debug(
      `Supermajority check: ${attestations.length}/${committeeSize} (required: ${required}) → ${hasSupermajority ? '✅' : '❌'}`,
    );

    return hasSupermajority;
  }

  /**
   * 블록 검증 (간단 버전)
   *
   * 이더리움:
   * - parentHash 연결
   * - timestamp 순서
   * - State Root 검증
   * - Transactions Root 검증
   * - Proposer 권한 확인
   * - 모든 트랜잭션 검증
   *
   * 현재:
   * - 일단 모두 통과 (true)
   * - 나중에 실제 검증 로직 추가
   *
   * @param block - 검증할 블록
   * @returns 검증 성공 여부
   */
  private async validateBlock(block: Block): Promise<boolean> {
    // TODO: 실제 검증 로직 구현 (Phase 3-2)
    // - parentHash 확인
    // - timestamp 확인
    // - State Root 검증
    // - Transactions Root 검증
    // - Proposer 권한 확인

    return true; // 임시로 모두 통과
  }

  /**
   * Attestation 서명 생성 (임시)
   *
   * 이더리움:
   * - BLS 서명 사용
   * - Validator의 개인키로 서명
   * - 여러 서명을 하나로 집계 가능
   *
   * 현재:
   * - 임시 더미 서명
   * - Validator 개인키 없음
   * - 나중에 실제 서명 추가
   *
   * @param validator - 검증자 주소
   * @param block - 검증하는 블록
   * @returns 서명
   */
  private createAttestationSignature(
    validator: Address,
    block: Block,
  ): Signature {
    // Attestation 메시지: validator + blockHash
    const message = this.cryptoService.hashUtf8(
      `${validator}-${block.hash}-attestation`,
    );

    // 임시 서명 (실제 개인키 없음)
    return {
      v: 27,
      r: message.slice(0, 66), // 32 bytes
      s: message.slice(0, 66), // 32 bytes
    };
  }

  /**
   * 현재 슬롯 계산
   */
  getCurrentSlot(): number {
    if (!this.genesisTime) {
      throw new Error('Genesis Time not set');
    }

    const now = Date.now();
    const timeSinceGenesis = now - this.genesisTime;
    return Math.floor(timeSinceGenesis / BLOCK_TIME);
  }

  /**
   * 현재 에포크 계산
   *
   * 이더리움:
   * - 1 Epoch = 32 Slots = 6.4분
   * - 에포크마다 Validator 셔플링
   * - Checkpoint & Finality
   */
  getCurrentEpoch(): number {
    const currentSlot = this.getCurrentSlot();
    return Math.floor(currentSlot / EPOCH_SIZE);
  }

  /**
   * 에포크 시작 슬롯
   */
  getEpochStartSlot(epoch: number): number {
    return epoch * EPOCH_SIZE;
  }

  /**
   * 에포크 종료 슬롯
   */
  getEpochEndSlot(epoch: number): number {
    return (epoch + 1) * EPOCH_SIZE - 1;
  }

  /**
   * Consensus 통계
   */
  getStats() {
    if (!this.genesisTime) {
      return {
        genesisTime: null,
        currentSlot: null,
        currentEpoch: null,
      };
    }

    const currentSlot = this.getCurrentSlot();
    const currentEpoch = this.getCurrentEpoch();

    return {
      genesisTime: new Date(this.genesisTime).toISOString(),
      currentSlot,
      currentEpoch,
      epochStartSlot: this.getEpochStartSlot(currentEpoch),
      epochEndSlot: this.getEpochEndSlot(currentEpoch),
      slotsPerEpoch: EPOCH_SIZE,
    };
  }
}
