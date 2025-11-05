import { Test, TestingModule } from '@nestjs/testing';
import { ContractController } from '../../src/contract/contract.controller';
import { ContractService } from '../../src/contract/contract.service';

/**
 * ContractController 테스트
 */
describe('ContractController', () => {
  let controller: ContractController;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    const mockContractService = {
      getContractBytecode: jest.fn(),
      callContract: jest.fn(),
      deployContract: jest.fn(),
      executeContract: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractController],
      providers: [
        {
          provide: ContractService,
          useValue: mockContractService,
        },
      ],
    }).compile();

    controller = module.get<ContractController>(ContractController);
    contractService = module.get(ContractService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getContractBytecode', () => {
    it('바이트코드를 조회해야 함', async () => {
      const address = '0x' + '1'.repeat(40);
      const bytecode = {
        address,
        bytecode: '0x6080604052348015600f57600080fd5b',
        codeHash: '0x' + 'h'.repeat(64),
      };

      contractService.getContractBytecode.mockResolvedValue(bytecode);

      const result = await controller.getContractBytecode(address);

      expect(result).toEqual(bytecode);
    });
  });

  describe('callContract', () => {
    it('컨트랙트를 호출해야 함', async () => {
      const result = {
        result: '0x0000000000000000000000000000000000000000000000000000000000000001',
        gasUsed: '0x5208',
      };

      contractService.callContract.mockResolvedValue(result);

      const response = await controller.callContract({
        to: '0x' + '1'.repeat(40),
        data: '0x' + '0'.repeat(8),
      });

      expect(response).toEqual(result);
    });
  });

  describe('deployContract', () => {
    it('컨트랙트를 배포해야 함', async () => {
      const result = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      contractService.deployContract.mockResolvedValue(result);

      const response = await controller.deployContract({
        bytecode: '0x6080604052348015600f57600080fd5b',
      });

      expect(response).toEqual(result);
    });
  });

  describe('executeContract', () => {
    it('컨트랙트를 실행해야 함', async () => {
      const result = {
        hash: '0x' + 'h'.repeat(64),
        status: 'pending',
      };

      contractService.executeContract.mockResolvedValue(result);

      const response = await controller.executeContract({
        to: '0x' + '1'.repeat(40),
        data: '0x' + '0'.repeat(8),
      });

      expect(response).toEqual(result);
    });
  });
});

