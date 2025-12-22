import { Injectable, Logger } from '@nestjs/common';
import { Address } from '../common/types/common.types';
import { ContractService } from './contract.service';

/**
 * Stablecoin Service
 *
 * 스테이블코인 시스템 관련 비즈니스 로직
 */
@Injectable()
export class StablecoinService {
  private readonly logger = new Logger(StablecoinService.name);

  constructor(private readonly contractService: ContractService) {}

  /**
   * 담보 예치
   *
   * @param privateKey - 사용자 개인키
   * @param amount - 예치할 금액 (Wei 단위)
   * @returns 트랜잭션 해시
   */
  async depositCollateral(
    privateKey: string,
    amount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    // depositCollateral()은 payable 함수이므로 data는 빈 함수 호출
    // value로 금액 전송
    const data = this.contractService.encodeFunctionCall(
      'depositCollateral',
      [],
      [],
    );

    // Hex string을 BigInt로 변환 (이더리움 JSON-RPC 표준)
    const amountBigInt = BigInt(amount);

    return await this.contractService.executeContractByUser(
      vaultAddress,
      data,
      privateKey,
      amountBigInt,
    );
  }

  /**
   * 스테이블코인 발행
   *
   * @param privateKey - 사용자 개인키
   * @param stablecoinAmount - 발행할 스테이블코인 양 (Wei 단위)
   * @returns 트랜잭션 해시
   */
  async mintStablecoin(
    privateKey: string,
    stablecoinAmount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'mintStablecoin',
      ['uint256'],
      [stablecoinAmount],
    );

    return await this.contractService.executeContractByUser(
      vaultAddress,
      data,
      privateKey,
      0n,
    );
  }

  /**
   * 스테이블코인 상환
   *
   * @param privateKey - 사용자 개인키
   * @param stablecoinAmount - 상환할 스테이블코인 양 (Wei 단위)
   * @returns 트랜잭션 해시
   */
  async redeemStablecoin(
    privateKey: string,
    stablecoinAmount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'redeemStablecoin',
      ['uint256'],
      [stablecoinAmount],
    );

    return await this.contractService.executeContractByUser(
      vaultAddress,
      data,
      privateKey,
      0n,
    );
  }

  /**
   * 담보 인출
   *
   * @param privateKey - 사용자 개인키
   * @param amount - 인출할 금액 (Wei 단위)
   * @returns 트랜잭션 해시
   */
  async withdrawCollateral(
    privateKey: string,
    amount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'withdrawCollateral',
      ['uint256'],
      [amount],
    );

    return await this.contractService.executeContractByUser(
      vaultAddress,
      data,
      privateKey,
      0n,
    );
  }

  /**
   * 청산 실행
   *
   * @param privateKey - 청산 실행자 개인키
   * @param userAddress - 청산 대상 사용자 주소
   * @returns 트랜잭션 해시
   */
  async liquidate(
    privateKey: string,
    userAddress: Address,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'liquidate',
      ['address'],
      [userAddress],
    );

    return await this.contractService.executeContractByUser(
      vaultAddress,
      data,
      privateKey,
      0n,
    );
  }

  /**
   * 포지션 조회 (View 함수)
   *
   * @param userAddress - 사용자 주소
   * @returns 포지션 정보
   */
  async getPosition(userAddress: Address): Promise<{
    collateralAmount: string;
    debtAmount: string;
    collateralRatio: string;
  }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'getPosition',
      ['address'],
      [userAddress],
    );

    const result = await this.contractService.callContract(vaultAddress, data);

    // 결과는 3개의 uint256 (각 32바이트 = 64 hex chars)
    // 첫 번째 32바이트: collateralAmount
    // 두 번째 32바이트: debtAmount
    // 세 번째 32바이트: collateralRatio
    // 스캔 백엔드에서 디코딩하므로 여기서는 hex string을 분리만 함
    const hexResult = result.result.startsWith('0x')
      ? result.result.slice(2)
      : result.result;

    // 각 32바이트(64 hex chars)씩 분리
    const collateralAmountHex = '0x' + hexResult.slice(0, 64);
    const debtAmountHex = '0x' + hexResult.slice(64, 128);
    const collateralRatioHex = '0x' + hexResult.slice(128, 192);

    return {
      collateralAmount: collateralAmountHex,
      debtAmount: debtAmountHex,
      collateralRatio: collateralRatioHex,
    };
  }

  /**
   * 건강도 확인 (View 함수)
   *
   * @param userAddress - 사용자 주소
   * @returns 건강도 여부 (원본 hex string)
   */
  async isHealthy(userAddress: Address): Promise<string> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.vault) {
      throw new Error('CollateralVault is not deployed');
    }

    const vaultAddress = deployed.vault.address;

    const data = this.contractService.encodeFunctionCall(
      'isHealthy',
      ['address'],
      [userAddress],
    );

    const result = await this.contractService.callContract(vaultAddress, data);

    // 스캔 백엔드에서 디코딩하므로 여기서는 원본 hex 반환
    return result.result;
  }

  /**
   * 스테이블코인 전송
   *
   * @param privateKey - 사용자 개인키
   * @param to - 수신자 주소
   * @param amount - 전송할 스테이블코인 양 (Wei 단위, Hex String)
   * @returns 트랜잭션 해시
   */
  async transferStablecoin(
    privateKey: string,
    to: Address,
    amount: string,
  ): Promise<{ hash: string; status: string }> {
    const deployed = this.contractService.getDeployedContracts();
    if (!deployed || !deployed.stablecoin) {
      throw new Error('StableCoin is not deployed');
    }

    const stablecoinAddress = deployed.stablecoin.address;

    // transfer(address to, uint256 amount) 함수 호출
    const data = this.contractService.encodeFunctionCall(
      'transfer',
      ['address', 'uint256'],
      [to, amount],
    );

    return await this.contractService.executeContractByUser(
      stablecoinAddress,
      data,
      privateKey,
      0n,
    );
  }
}
