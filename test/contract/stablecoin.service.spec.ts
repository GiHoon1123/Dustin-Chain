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
      const amount = '1000000000000000000000';
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + '0'.repeat(8));
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.depositCollateral(privateKey, amount);

      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('status');
      expect(contractService.encodeFunctionCall).toHaveBeenCalledWith('depositCollateral', [], []);
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
        service.depositCollateral('0x' + '1'.repeat(64), '1000000000000000000000'),
      ).rejects.toThrow('CollateralVault is not deployed');
    });
  });

  describe('스테이블코인 발행', () => {
    it('스테이블코인을 발행해야 함', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const stablecoinAmount = '500000000000000000000';
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'a'.repeat(8) + '0'.repeat(56));
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
      const stablecoinAmount = '200000000000000000000';
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'b'.repeat(8) + '0'.repeat(56));
      contractService.executeContractByUser.mockResolvedValue({
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      });

      const result = await service.redeemStablecoin(privateKey, stablecoinAmount);

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
      const amount = '100000000000000000000';
      const vaultAddress = '0x' + '2'.repeat(40);

      contractService.getDeployedContracts.mockReturnValue({
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'c'.repeat(8) + '0'.repeat(56));
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
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'd'.repeat(8) + '0'.repeat(56));
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
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'e'.repeat(8) + '0'.repeat(56));
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
        stablecoin: { address: '0x' + '1'.repeat(40), name: 'StableCoin', deployedAt: '2025-01-01' },
        vault: { address: vaultAddress, name: 'CollateralVault', deployedAt: '2025-01-01' },
      });

      contractService.encodeFunctionCall.mockReturnValue('0x' + 'f'.repeat(8) + '0'.repeat(56));
      contractService.callContract.mockResolvedValue({
        result: '0x0000000000000000000000000000000000000000000000000000000000000001',
        gasUsed: '0x5208',
      });

      const result = await service.isHealthy(userAddress);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});

