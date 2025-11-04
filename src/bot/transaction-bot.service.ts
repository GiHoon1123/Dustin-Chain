import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { AccountService } from '../account/account.service';
import { CHAIN_ID } from '../common/constants/blockchain.constants';
import { CryptoService } from '../common/crypto/crypto.service';
import { Address } from '../common/types/common.types';
import { TransactionService } from '../transaction/transaction.service';

interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Transaction Bot Service
 *
 * 역할:
 * - 10초마다 4-5개 트랜잭션 자동 생성
 * - 인덱스 100-255 계정 간 무작위 송금
 * - 최소 잔액 체크 (1 DSTN)
 * - 10분마다 컨트랙트 배포 (순차적으로)
 *
 * 목적:
 * - 네트워크 활성화
 * - 블록 히스토리 생성
 * - 실제 블록체인처럼 보이게
 * - 컨트랙트 자동 배포
 */
@Injectable()
export class TransactionBotService {
  private readonly logger = new Logger(TransactionBotService.name);
  private readonly MIN_BALANCE = BigInt(1) * BigInt(10 ** 18); // 1 DSTN (최소 잔액)
  private readonly MIN_INDEX = 100;
  private readonly MAX_INDEX = 255;
  private accounts: GenesisAccount[] = [];
  private genesisAccount0: GenesisAccount | null = null;
  private isRunning = false;
  private txCount = 0; // 생성된 트랜잭션 수 (일반 + 컨트랙트 배포)
  private contractDeployCount = 0; // 컨트랙트 배포 트랜잭션 수

  // 컨트랙트 바이트코드 배열 (4개)
  private readonly contractBytecodes: string[] = [
    '0x608060405234801561000f575f5ffd5b50604051611416380380611416833981810160405281019061003191906102f5565b335f5f6101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506001805f5f5f9054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f01819055505f5f90505b815181101561015a57600260405180604001604052808484815181106101025761010161033c565b5b602002602001015181526020015f815250908060018154018082558091505060019003905f5260205f2090600202015f909190919091505f820151815f015560208201518160010155505080806001019150506100d9565b5050610369565b5f604051905090565b5f5ffd5b5f5ffd5b5f5ffd5b5f601f19601f8301169050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b6101bc82610176565b810181811067ffffffffffffffff821117156101db576101da610186565b5b80604052505050565b5f6101ed610161565b90506101f982826101b3565b919050565b5f67ffffffffffffffff82111561021857610217610186565b5b602082029050602081019050919050565b5f5ffd5b5f819050919050565b61023f8161022d565b8114610249575f5ffd5b50565b5f8151905061025a81610236565b92915050565b5f61027261026d846101fe565b6101e4565b9050808382526020820190506020840283018581111561029557610294610229565b5b835b818110156102be57806102aa888261024c565b845260208401935050602081019050610297565b5050509392505050565b5f82601f8301126102dc576102db610172565b5b81516102ec848260208601610260565b91505092915050565b5f6020828403121561030a5761030961016a565b5b5f82015167ffffffffffffffff8111156103275761032661016e565b5b610333848285016102c8565b91505092915050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52603260045260245ffd5b6110a0806103765f395ff3fe608060405234801561000f575f5ffd5b5060043610610086575f3560e01c8063609ff1bd11610059578063609ff1bd146101115780639e7b8d611461012f578063a3ec138d1461014b578063e2ba53f01461017e57610086565b80630121b93f1461008a578063013cf08b146100a65780632e4176cf146100d75780635c19a95c146100f5575b5f5ffd5b6100a4600480360381019061009f9190610a24565b61019c565b005b6100c060048036038101906100bb9190610a24565b6102d7565b6040516100ce929190610a76565b60405180910390f35b6100df610306565b6040516100ec9190610adc565b60405180910390f35b61010f600480360381019061010a9190610b1f565b61032a565b005b610119610704565b6040516101269190610b4a565b60405180910390f35b61014960048036038101906101449190610b1f565b610782565b005b61016560048036038101906101609190610b1f565b610965565b6040516101759493929190610b7d565b60405180910390f35b6101866109bd565b6040516101939190610bc0565b60405180910390f35b5f60015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2090505f815f015403610221576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161021890610c33565b60405180910390fd5b806001015f9054906101000a900460ff1615610272576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161026990610c9b565b60405180910390fd5b6001816001015f6101000a81548160ff021916908315150217905550818160020181905550805f0154600283815481106102af576102ae610cb9565b5b905f5260205f2090600202016001015f8282546102cc9190610d13565b925050819055505050565b600281815481106102e6575f80fd5b905f5260205f2090600202015f91509050805f0154908060010154905082565b5f5f9054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b5f60015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2090505f815f0154036103af576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016103a690610d90565b60405180910390fd5b806001015f9054906101000a900460ff1615610400576040517f08c379a00000000000000000000000000000000000000000000081526004016103f790610df8565b60405180910390fd5b3373ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff160361046e576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161046590610e60565b60405180910390fd5b5b5f73ffffffffffffffffffffffffffffffffffffffff1660015f8473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2060010160019054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16146105d85760015f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2060010160019054906101000a900473ffffffffffffffffffffffffffffffffffffffff1691503373ffffffffffffffffffffffffffffffffffffffff168273ffffffffffffffffffffffffffffffffffffffff16036105d3576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016105ca90610ec8565b60405180910390fd5b61046f565b5f60015f8473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2090506001815f01541015610628575f5ffd5b6001826001015f6101000a81548160ff021916908315150217905550828260010160016101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550806001015f9054906101000a900460ff16156106e257815f015460028260020154815481106106b9576106b8610cb9565b5b905f5260205f2090600202016001015f8282546106d69190610d13565b925050819055506106ff565b815f0154815f015f8282546106f79190610d13565b925050819055505b505050565b5f5f5f90505f5f90505b60028054905081101561077d5781600282815481106107305761072f610cb9565b5b905f5260205f209060020201600101541115610770576002818154811061075a57610759610cb9565b5b905f5260205f2090600202016001015491508092505b808060010191505061070e565b505090565b5f5f9054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614610810576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161080790610f56565b60405180910390fd5b60015f8273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f206001015f9054906101000a900460ff161561089d576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161089490610fbe565b60405180910390fd5b5f60015f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f01541461091e576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016109159061104c565b60405180910390fd5b6001805f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f018190555050565b6001602052805f5260405f205f91509050805f015490806001015f9054906101000a900460ff16908060010160019054906101000a900473ffffffffffffffffffffffffffffffffffffffff16908060020154905084565b5f60026109c8610704565b815481106109d9576109d8610cb9565b5b905f5260205f2090600202015f0154905090565b5f5ffd5b5f819050919050565b610a03816109f1565b8114610a0d575f5ffd5b50565b5f81359050610a1e816109fa565b92915050565b5f60208284031215610a3957610a386109ed565b5b5f610a4684828501610a10565b91505092915050565b5f819050919050565b610a6181610a4f565b82525050565b610a70816109f1565b82525050565b5f604082019050610a895f830185610a58565b610a966020830184610a67565b939250505050565b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f610ac682610a9d565b9050919050565b610ad681610abc565b82525050565b5f602082019050610aef5f830184610acd565b92915050565b610afe81610abc565b8114610b08575f5ffd5b50565b5f81359050610b1981610af5565b92915050565b5f60208284031215610b3457610b336109ed565b5b5f610b4184828501610b0b565b91505092915050565b5f602082019050610b5d5f830184610a67565b92915050565b5f8115159050919050565b610b7781610b63565b82525050565b5f608082019050610b905f830187610a67565b610b9d6020830186610b6e565b610baa6040830185610acd565b610bb76060830184610a67565b95945050505050565b5f602082019050610bd35f830184610a58565b92915050565b5f82825260208201905092915050565b7f486173206e6f20726967687420746f20766f74650000000000000000000000005f82015250565b5f610c1d601483610bd9565b9150610c2882610be9565b602082019050919050565b5f6020820190508181035f830152610c4a81610c11565b9050919050565b7f416c726561647920766f7465642e0000000000000000000000000000000000005f82015250565b5f610c85600e83610bd9565b9150610c9082610c51565b602082019050919050565b5f6020820190508181035f830152610cb281610c79565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52603260045260245ffd5b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f610d1d826109f1565b9150610d28836109f1565b9250828201905080821115610d4057610d3f610ce6565b5b92915050565b7f596f752068617665206e6f20726967687420746f20766f7465000000000000005f82015250565b5f610d7a601983610bd9565b9150610d8582610d46565b602082019050919050565b5f6020820190508181035f830152610da781610d6e565b9050919050565b7f596f7520616c726561647920766f7465642e00000000000000000000000000005f82015250565b5f610de2601283610bd9565b9150610ded82610dae565b602082019050919050565b5f6020820190508181035f830152610e0f81610dd6565b9050919050565b7f53656c662d64656c65676174696f6e20697320646973616c6c6f7765642e00005f82015250565b5f610e4a601e83610bd9565b9150610e5582610e16565b602082019050919050565b5f6020820190508181035f830152610e7781610e3e565b9050919050565b7f466f756e64206c6f6f7020696e2064656c65676174696f6e2e000000000000005f82015250565b5f610eb2601983610bd9565b9150610ebd82610e7e565b602082019050919050565b5f6020820190508181035f830152610edf81610ea6565b9050919050565b7f4f6e6c79206368616972706572736f6e2063616e2067697665207269676874205f8201527f746f20766f74652e000000000000000000000000000000000000000000000000602082015250565b5f610f40602883610bd9565b9150610f4b82610ee6565b604082019050919050565b5f6020820190508181035f830152610f6d81610f34565b9050919050565b7f54686520766f74657220616c726561647920766f7465642e00000000000000005f82015250565b5f610fa8601883610bd9565b9150610fb382610f74565b602082019050919050565b5f6020820190508181035f830152610fd581610f9c565b9050919050565b7f566f74657220616c7265616479206861732074686520726967687420746f20765f8201527f6f74652e00000000000000000000000000000000000000000000000000000000602082015250565b5f611036602483610bd9565b915061104182610fdc565b604082019050919050565b5f6020820190508181035f8301526110638161102a565b9050919050565fea264697066735822122057810173e1b31a821035edf889dd0205152d3c1af12e840fcc43bf7ab970b30664736f6c634300081e0033',
    '0x6080604052348015600e575f5ffd5b5061025f8061001c5f395ff3fe608060405234801561000f575f5ffd5b506004361061004a575f3560e01c8063209652551461004e578063552410771461006c5780636d619daa14610088578063771602f7146100a6575b5f5ffd5b6100566100d6565b6040516100639190610119565b60405180910390f35b61008660048036038101906100819190610160565b6100de565b005b6100906100e7565b60405161009d9190610119565b60405180910390f35b6100c060048036038101906100bb919061018b565b6100ec565b6040516100cd9190610119565b60405180910390f35b5f5f54905090565b805f8190555050565b5f5481565b5f81836100f991906101f6565b905092915050565b5f819050919050565b61011381610101565b82525050565b5f60208201905061012c5f83018461010a565b92915050565b5f5ffd5b61013f81610101565b8114610149575f5ffd5b50565b5f8135905061015a81610136565b92915050565b5f6020828403121561017557610174610132565b5b5f6101828482850161014c565b91505092915050565b5f5f604083850312156101a1576101a0610132565b5b5f6101ae8582860161014c565b92505060206101bf8582860161014c565b9150509250929050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f61020082610101565b915061020b83610101565b9250828201905080821115610223576102226101c9565b5b9291505056fea264697066735822122094537bed2637acb77bdd85cb27b30989239b4628c5e1b2656035883958d38f6564736f6c634300081e0033',
    '0x608060405234801561000f575f5ffd5b506100556040518060400160405280601b81526020017f4f776e657220636f6e7472616374206465706c6f7965642062793a00000000008152503361011360201b60201c565b335f5f6101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505f5f9054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff165f73ffffffffffffffffffffffffffffffffffffffff167f342827c97908e5e2f71151c08502a66d44b6f758e3ac2f1de95f02eb95f0a73560405160405180910390a361031e565b6101b182826040516024016101299291906102c3565b6040516020818303038152906040527f319af333000000000000000000000000000000000000000000000000000000007bffffffffffffffffffffffffffffffffffffffffffffffffffffffff19166020820180517bffffffffffffffffffffffffffffffffffffffffffffffffffffffff83818316178352505050506101b560201b60201c565b5050565b6101d6816101d16101d960201b610251176101f860201b60201c565b60201c565b50565b5f6a636f6e736f6c652e6c6f6790505f5f835160208501845afa505050565b61020a60201b61027017819050919050565b6102126102f1565b565b5f81519050919050565b5f82825260208201905092915050565b8281835e5f83830152505050565b5f601f19601f8301169050919050565b5f61025682610214565b610260818561021e565b935061027081856020860161022e565b6102798161023c565b840191505092915050565b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6102ad82610284565b9050919050565b6102bd816102a3565b82525050565b5f6040820190506102cc5f8301846102aa565b92915050565b5f5ffd5b6102df81610299565b81146102e9575f5ffd5b50565b5f813590506102fa816102d6565b92915050565b5f60208284031215610315576103146102d2565b5b5f610322848285016102ec565b91505092915050565b5f82825260208201905092915050565b7f43616c6c6572206973206e6f74206f776e6572000000000000000000000000005f82015250565b5f61036f60138361032b565b915061037a8261033b565b602082019050919050565b5f6020820190508181035f83015261039c81610363565b9050919050565b7f4e6577206f776e65722073686f756c64206e6f7420626520746865207a65726f5f8201527f2061646472657373000000000000000000000000000000000000000000000000602082015250565b5f6103fd60288361032b565b9150610408826103a3565b604082019050919050565b5f6020820190508181035f83015261042a816103f1565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52605160045260245ffdfea2646970667358221220523d1a04cb484ceecf188b2a9bd9c1473eddd3af5a091583b8a69e41b6d4c58364736f6c634300081e0033',
    '0x608060405234801561000f575f5ffd5b506004361061004a575f3560e01c806309ff1bd61461004e578063209652551461006c578063552410771461008a5780636d619daa146100a8578063771602f7146100c6575b5f5ffd5b6100566100e4565b6040516100639190610124565b60405180910390f35b6100746100ec565b6040516100819190610124565b60405180910390f35b6100926100f2565b60405161009f9190610124565b60405180910390f35b6100b06100f8565b6040516100bd9190610124565b60405180910390f35b6100ce6100fe565b6040516100db9190610124565b60405180910390f35b5f8054905090565b5f5490565b60015481565b60025481565b60035481565b5f819050919050565b61011e81610104565b82525050565b5f6020820190506101375f830184610115565b9291505056fea2646970667358221220a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef64736f6c634300081e0033',
  ];

  constructor(
    private readonly transactionService: TransactionService,
    private readonly accountService: AccountService,
    private readonly cryptoService: CryptoService,
  ) {}

  async onApplicationBootstrap() {
    this.loadAccounts();
    this.loadGenesisAccount0();
    this.isRunning = true;
    // this.logger.log(
    //   `🤖 TransactionBot started (${this.accounts.length} accounts active)`,
    // );
    // this.logger.log(
    //   `📊 Target: 0.4-0.5 tx/sec, ~24-30 tx/block (60s), ~1,440-1,800 tx/hour`,
    // );
  }

  /**
   * genesis-accounts.json에서 인덱스 100-255 계정 로드
   */
  private loadAccounts(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 인덱스 100-255만 필터링
      this.accounts = allAccounts.filter(
        (acc) => acc.index >= this.MIN_INDEX && acc.index <= this.MAX_INDEX,
      );

      // this.logger.log(`Loaded ${this.accounts.length} bot accounts`);
    } catch (error: any) {
      this.logger.error(`Failed to load accounts: ${error.message}`);
    }
  }

  /**
   * 제네시스 계정 0번 로드 (컨트랙트 배포용)
   */
  private loadGenesisAccount0(): void {
    try {
      const accountsPath = this.findAccountsFile();
      if (!accountsPath) {
        this.logger.error('genesis-accounts.json not found');
        return;
      }

      const fileContent = fs.readFileSync(accountsPath, 'utf8');
      const allAccounts: GenesisAccount[] = JSON.parse(fileContent);

      // 인덱스 0번 찾기
      this.genesisAccount0 = allAccounts.find((acc) => acc.index === 0) || null;

      if (this.genesisAccount0) {
        this.logger.log(
          `Genesis account 0 loaded for contract deployment: ${this.genesisAccount0.address}`,
        );
      } else {
        this.logger.error('Genesis account 0 not found');
      }
    } catch (error: any) {
      this.logger.error(`Failed to load genesis account 0: ${error.message}`);
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

  /**
   * 10초마다 4-5개 트랜잭션 생성
   *
   * 결과:
   * - 60초(1블록) = 4-5개 × 6회 = 24-30개 트랜잭션
   * - 시간당 = 1,440-1,800개 트랜잭션
   */
  @Interval(600000)
  async generateTransactions() {
    if (!this.isRunning || this.accounts.length === 0) {
      return;
    }

    try {
      // 4-5개 무작위
      const count = Math.floor(Math.random() * 2) + 4; // 4 or 5

      for (let i = 0; i < count; i++) {
        await this.sendRandomTransaction();
      }
    } catch (error: any) {
      this.logger.error(`Bot error: ${error.message}`);
    }
  }

  /**
   * 10분마다 컨트랙트 배포 (600,000ms = 10분)
   *
   * 4개의 컨트랙트 중 랜덤으로 하나를 선택하여 배포
   */
  @Interval(600000)
  async deployContract() {
    if (!this.isRunning || !this.genesisAccount0) {
      return;
    }

    if (this.contractBytecodes.length === 0) {
      return;
    }

    try {
      // 4개 컨트랙트 중 랜덤으로 하나 선택
      const randomIndex = Math.floor(
        Math.random() * this.contractBytecodes.length,
      );
      const bytecode = this.contractBytecodes[randomIndex];

      // 잔액 체크
      const balance = await this.accountService.getBalance(
        this.genesisAccount0.address,
      );
      const gasPrice = BigInt(1000000000); // 1 Gwei
      const gasLimit = BigInt(5000000); // 컨트랙트 배포는 가스가 많이 필요
      const totalCost = gasPrice * gasLimit;

      if (balance < totalCost) {
        this.logger.warn(
          `Insufficient balance for contract deployment: ${this.genesisAccount0.address}`,
        );
        return;
      }

      // Nonce 가져오기
      const nonce = await this.accountService.getNonce(
        this.genesisAccount0.address,
      );

      // 컨트랙트 배포 트랜잭션 (to = null, data = bytecode)
      const txData = {
        from: this.genesisAccount0.address,
        to: null, // 컨트랙트 배포는 to가 null
        value: '0',
        nonce,
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        data: bytecode,
        chainId: CHAIN_ID,
      };
      const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

      // 트랜잭션 서명 (EIP-155)
      const signature = this.cryptoService.signTransaction(
        txHash,
        this.genesisAccount0.privateKey,
        CHAIN_ID,
      );

      // 트랜잭션 제출
      await this.transactionService.submitTransaction(
        this.genesisAccount0.address,
        null, // 컨트랙트 배포는 to가 null
        BigInt(0),
        nonce,
        signature,
        {
          gasPrice,
          gasLimit,
          data: bytecode,
        },
      );

      // 트랜잭션 카운터 증가
      this.txCount++;
      this.contractDeployCount++;

      this.logger.log(
        `✅ Contract deployment #${randomIndex + 1}/${this.contractBytecodes.length} (random) submitted (nonce: ${nonce})`,
      );
    } catch (error: any) {
      this.logger.error(`Contract deployment failed: ${error.message}`);
    }
  }

  /**
   * 무작위 트랜잭션 생성 및 전송
   */
  private async sendRandomTransaction(): Promise<void> {
    try {
      // 1. 무작위 송신자 선택
      const fromAccount = this.selectRandomAccount();

      // 2. 잔액 체크
      const balance = await this.accountService.getBalance(fromAccount.address);
      if (balance < this.MIN_BALANCE) {
        // this.logger.debug(
        //   `Account ${fromAccount.address.slice(0, 10)}... has insufficient balance (${this.formatDSTN(balance)} DSTN)`,
        // );
        return;
      }

      // 3. 무작위 수신자 선택 (송신자 제외)
      const toAccount = this.selectRandomAccount(fromAccount.address);

      // 4. 무작위 금액 (0.5~10 DSTN)
      const amount =
        BigInt(Math.floor(Math.random() * 95 + 5)) * BigInt(10 ** 17); // 0.5~10 DSTN

      // 5. 잔액 충분한지 재확인 (금액 + 가스비)
      const gasPrice = BigInt(1000000000); // 1 Gwei
      const gasLimit = BigInt(21000);
      const totalCost = amount + gasPrice * gasLimit;

      if (balance < totalCost + this.MIN_BALANCE) {
        // this.logger.debug(
        //   `Account ${fromAccount.address.slice(0, 10)}... cannot afford tx (needs ${this.formatDSTN(totalCost)} + 1 DSTN reserve)`,
        // );
        return;
      }

      // 6. Nonce 가져오기
      const nonce = await this.accountService.getNonce(fromAccount.address);

      // 7. 트랜잭션 해시 계산 (TransactionService와 동일한 방식)
      const data = '0x';
      const txData = {
        from: fromAccount.address,
        to: toAccount.address,
        value: amount.toString(),
        nonce,
        gasPrice: gasPrice.toString(),
        gasLimit: gasLimit.toString(),
        data,
        chainId: CHAIN_ID,
      };
      const txHash = this.cryptoService.hashUtf8(JSON.stringify(txData));

      // 8. 트랜잭션 서명 (EIP-155)
      const signature = this.cryptoService.signTransaction(
        txHash,
        fromAccount.privateKey,
        CHAIN_ID,
      );

      // 9. 트랜잭션 제출
      await this.transactionService.submitTransaction(
        fromAccount.address,
        toAccount.address,
        amount,
        nonce,
        signature,
        {
          gasPrice,
          gasLimit,
          data,
        },
      );

      // 트랜잭션 카운터 증가
      this.txCount++;

      // this.logger.debug(
      //   `✅ Bot TX: ${fromAccount.address.slice(0, 8)}...→${toAccount.address.slice(0, 8)}... (${this.formatDSTN(amount)} DSTN)`,
      // );
    } catch (error: any) {
      // 에러는 조용히 무시 (Nonce 충돌 등)
      // this.logger.debug(`Bot TX failed: ${error.message}`);
    }
  }

  /**
   * 무작위 계정 선택
   */
  private selectRandomAccount(excludeAddress?: Address): GenesisAccount {
    // Modern approach: filter 후 random 선택
    const candidates = excludeAddress
      ? this.accounts.filter((acc) => acc.address !== excludeAddress)
      : this.accounts;

    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * DSTN 포맷 (Wei → DSTN)
   */
  private formatDSTN(wei: bigint): string {
    const dstn = Number(wei) / 10 ** 18;
    return dstn.toFixed(2);
  }

  /**
   * 봇 통계 조회
   */
  async getStats() {
    return {
      isRunning: this.isRunning,
      activeAccounts: this.accounts.length,
      minBalance: '1 DSTN',
      targetRate: '0.4-0.5 tx/sec',
      expectedTxPerBlock: '24-30',
      expectedTxPerHour: '1,440-1,800',
      totalTransactions: this.txCount,
      contractDeployments: this.contractDeployCount,
      regularTransactions: this.txCount - this.contractDeployCount,
    };
  }

  /**
   * 봇 상태 조회 (API용)
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      accountCount: this.accounts.length,
      minBalance: this.MIN_BALANCE.toString(),
      targetRate: '0.4-0.5 tx/sec',
      totalTransactions: this.txCount,
      contractDeployments: this.contractDeployCount,
    };
  }

  /**
   * 봇 중지 (필요시)
   */
  stop() {
    this.isRunning = false;
    // this.logger.log('🛑 TransactionBot stopped');
  }

  /**
   * 봇 재시작 (필요시)
   */
  start() {
    this.isRunning = true;
    // this.logger.log('🚀 TransactionBot restarted');
  }
}
