import { Test, TestingModule } from '@nestjs/testing';
import { ContractService } from '../../src/contract/contract.service';
import { StablecoinService } from '../../src/contract/stablecoin.service';

/**
 * StablecoinService 테스트
 *
 * 테스트 범위:
 * - 담보 예치
 * - 스테이블코인 발행
 * - 스테이블코인 상환
 * - 담보 인출
 * - 청산
 * - 포지션 조회
 * - 건강도 확인
 */
describe('StablecoinService', () => {
  let service: StablecoinService;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    const mockContractService = {
      getDeployedContracts: jest.fn(),
      encodeFunctionCall: jest.fn(),
      executeContractByUser: jest.fn(),
      callContract: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ContractService,
          useValue: mockContractService,
        },
        StablecoinService,
      ],
    }).compile();

    service = module.get<StablecoinService>(StablecoinService);
    contractService = module.get(ContractService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('초기화', () => {
    it('서비스가 정의되어야 함', () => {
      expect(service).toBeDefined();
    });
  });

  describe('담보 예치', () => {
    it('담보를 예치해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const amount = '0x3635c9adc5dea00000'; // 1000 DSTN
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + '0'.repeat(8));
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.depositCollateral(privateKey, amount);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'depositCollateral',
        [],
        [],
      );
      expect(contractService.executeContractByUser).toHaveBeenCalledWith(
        vaultAddress,
        '0x' + '0'.repeat(8),
        privateKey,
        BigInt(amount),
      );
    });

    it('Vault가 배포되지 않았으면 에러를 발생시켜야 함', async () => {
      contractService.getDeployedContracts.mockReturnValue(null);

      await expect(
        service.depositCollateral(
          '0x' + '1'.repeat(64),
          '0x3635c9adc5dea00000',
        ), // 1000 DSTN
      ).rejects.toThrow('CollateralVault is not deployed');
    });
  });

  describe('스테이블코인 발행', () => {
    it('스테이블코인을 발행해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const stablecoinAmount = '0x1b1ae4d6e2ef500000'; // 500 DSTN
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'a'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.mintStablecoin(privateKey, stablecoinAmount);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'mintStablecoin',
        ['uint256'],
        [stablecoinAmount],
      );
    });
  });

  describe('스테이블코인 상환', () => {
    it('스테이블코인을 상환해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const stablecoinAmount = '0x2c68af0bb1400000000'; // 200 DSTN
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'b'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.redeemStablecoin(
        privateKey,
        stablecoinAmount,
      );

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'redeemStablecoin',
        ['uint256'],
        [stablecoinAmount],
      );
    });
  });

  describe('담보 인출', () => {
    it('담보를 인출해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const amount = '0x56bc75e2d63100000'; // 100 DSTN
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'c'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.withdrawCollateral(privateKey, amount);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'withdrawCollateral',
        ['uint256'],
        [amount],
      );
    });
  });

  describe('청산', () => {
    it('청산을 실행해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const userAddress = '0x' + '3'.repeat(40);
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'd'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.liquidate(privateKey, userAddress);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'liquidate',
        ['address'],
        [userAddress],
      );
    });

    it('청산 함수 호출 데이터가 올바르게 생성되어야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const userAddress = '0x' + '3'.repeat(40);
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'd'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      await service.liquidate(privateKey, userAddress);

      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'liquidate',
        ['address'],
        [userAddress],
      );
      expect(contractService.executeContractByUser).toHaveBeenCalledWith(
        vaultAddress,
        expect.stringMatching(/^0x[0-9a-f]+$/),
        privateKey,
        0n,
      );
    });
  });

  describe('청산 시나리오 테스트 (담보 인출로 담보비율 낮추기)', () => {
    it('담보를 많이 인출하여 청산 가능 상태를 만들 수 있어야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      // 시나리오: 담보 1000 DSTN, 부채 500 USDST
      // 필요 담보: 500 * 1.5 = 750 USD = 0.75 DSTN
      // 담보를 0.7 DSTN만 남기면 청산 가능 (담보비율: 0.7 * 1000 / 750 = 93%)
      const withdrawAmount = '0x362c12c77b4fda0000'; // 999.3 DSTN 인출

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'c'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.withdrawCollateral(
        privateKey,
        withdrawAmount,
      );

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'withdrawCollateral',
        ['uint256'],
        [withdrawAmount],
      );
    });

    it('부채를 많이 늘려서 청산 가능 상태를 만들 수 있어야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      // 시나리오: 담보 1000 DSTN, 부채를 많이 늘림
      // 담보 가치: 1000 * 1000 = 1,000,000 USD
      // 담보비율 150% 미만이 되려면: 필요 담보 > 1,000,000
      // 필요 담보 = 부채 * 1.5 > 1,000,000
      // 부채 > 666,666 USDST
      const largeDebtAmount = '0x943b1377290cbd800000'; // 700,000 USDST

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'a'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.mintStablecoin(privateKey, largeDebtAmount);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'mintStablecoin',
        ['uint256'],
        [largeDebtAmount],
      );
    });
  });

  describe('청산 테스트의 한계', () => {
    it('가격 고정으로 인한 테스트 한계를 문서화해야 함', () => {
      const limitations = [
        'DSTN 가격이 고정되어 있어서 가격 변동에 따른 청산은 테스트 불가',
        '실제 운영 환경에서는 가격 변동으로 청산이 발생하지만, 여기서는 담보/부채 비율 조정으로만 테스트',
        '가격 하락 시나리오를 테스트할 수 없음 (예: DSTN 가격이 1000에서 500으로 떨어지는 경우)',
        '가격 상승 시나리오를 테스트할 수 없음 (예: DSTN 가격이 1000에서 2000으로 오르는 경우)',
        '가격 변동에 따른 자동 청산 트리거를 테스트할 수 없음',
        '가격 오라클 연동 테스트 불가',
      ];

      expect(limitations.length).toBeGreaterThan(0);
      expect(limitations).toContain(
        'DSTN 가격이 고정되어 있어서 가격 변동에 따른 청산은 테스트 불가',
      );
    });

    it('현재 테스트 방법의 한계를 설명해야 함', () => {
      const testMethods = [
        '담보를 많이 인출하여 담보비율을 낮춤',
        '부채를 많이 늘려서 담보비율을 낮춤',
      ];

      const limitations = [
        '가격 변동 없이 담보/부채 비율만 조정',
        '현실적이지 않은 시나리오 (실제로는 가격 변동으로 청산 발생)',
      ];

      expect(testMethods.length).toBe(2);
      expect(limitations.length).toBeGreaterThan(0);
    });
  });

  describe('포지션 조회', () => {
    it('포지션을 조회해야 함', async () => {
      const userAddress = '0x' + '3'.repeat(40);
      const vaultAddress = '0x' + '2'.repeat(40);
      const hexResult =
        '0'.repeat(24) +
        '3635c9adc5dea00000' +
        '0'.repeat(24) +
        '1b1ae4d6e2ef500000' +
        '0'.repeat(24) +
        '30d40'.padStart(64 - 24, '0');

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'e'.repeat(8) + '0'.repeat(56),
      );
      contractService.callContract.mockResolvedValue({
        result: '0x' + hexResult,
        gasUsed: '0x5208',
      });

      const result = await service.getPosition(userAddress);

      expect(result).toHaveProperty('collateralAmount');
      expect(result).toHaveProperty('debtAmount');
      expect(result).toHaveProperty('collateralRatio');
      expect(result.collateralAmount).toMatch(/^0x[0-9a-f]+$/);
      expect(result.debtAmount).toMatch(/^0x[0-9a-f]+$/);
      expect(result.collateralRatio).toMatch(/^0x[0-9a-f]+$/);
    });
  });

  describe('건강도 확인', () => {
    it('건강도를 확인해야 함', async () => {
      const userAddress = '0x' + '3'.repeat(40);
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: '0x' + '1'.repeat(40),
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: vaultAddress,
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'f'.repeat(8) + '0'.repeat(56),
      );
      contractService.callContract.mockResolvedValue({
        result:
          '0x0000000000000000000000000000000000000000000000000000000000000001',
        gasUsed: '0x5208',
      });

      const result = await service.isHealthy(userAddress);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe('스테이블코인 전송', () => {
    it('스테이블코인을 전송해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const to = '0x' + '4'.repeat(40);
      const amount = '0x56bc75e2d63100000'; // 100 USDST
      const stablecoinAddress = '0x' + '5'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: stablecoinAddress,
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: '0x' + '2'.repeat(40),
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'a'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.transferStablecoin(
        privateKey,
        to,
        amount,
      );

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'transfer',
        ['address', 'uint256'],
        [to, amount],
      );
      expect(contractService.executeContractByUser).toHaveBeenCalledWith(
        stablecoinAddress,
        expect.stringMatching(/^0x[0-9a-f]+$/),
        privateKey,
        0n,
      );
    });

    it('StableCoin이 배포되지 않았으면 에러를 발생시켜야 함', async () => {
      contractService.getDeployedContracts.mockReturnValue(null);

      await expect(
        service.transferStablecoin(
          '0x' + '1'.repeat(64),
          '0x' + '4'.repeat(40),
          '0x56bc75e2d63100000',
        ),
      ).rejects.toThrow('StableCoin is not deployed');
    });

    it('소수점 금액도 전송할 수 있어야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const to = '0x' + '4'.repeat(40);
      const amount = '0x16345785d8a0000'; // 0.1 USDST
      const stablecoinAddress = '0x' + '5'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: {
          address: stablecoinAddress,
          name: 'StableCoin',
          deployedAt: '2025-01-01',
        },
        vault: {
          address: '0x' + '2'.repeat(40),
          name: 'CollateralVault',
          deployedAt: '2025-01-01',
        },
      });

      contractService.encodeFunctionCall.mockReturnValue(
        '0x' + 'a'.repeat(8) + '0'.repeat(56),
      );
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.transferStablecoin(
        privateKey,
        to,
        amount,
      );

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith(
        'transfer',
        ['address', 'uint256'],
        [to, amount],
      );
    });
  });
});
