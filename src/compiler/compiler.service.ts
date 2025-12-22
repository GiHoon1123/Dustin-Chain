import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// solc는 동적 로딩을 사용하므로 require 사용

const solc = require('solc');

/**
 * Compiler Service
 *
 * Solidity 컨트랙트 컴파일 서비스
 *
 * 역할:
 * - Solidity 컨트랙트 파일 컴파일
 * - 바이트코드 및 ABI 추출
 * - 컴파일 결과 저장
 *
 * 사용 라이브러리:
 * - solc: Solidity 컴파일러 (Node.js 바인딩)
 *
 * 컴파일 결과:
 * - contract-bytecodes.json: 바이트코드 저장
 * - contract-abis.json: ABI 저장
 */
@Injectable()
export class CompilerService {
  private readonly logger = new Logger(CompilerService.name);
  private readonly contractsDir: string;
  private readonly bytecodesPath: string;
  private readonly abisPath: string;

  constructor() {
    // 프로젝트 루트 경로 찾기
    const rootDir = this.findProjectRoot();
    this.contractsDir = path.join(rootDir, 'contracts');
    this.bytecodesPath = path.join(rootDir, 'contract-bytecodes.json');
    this.abisPath = path.join(rootDir, 'contract-abis.json');
  }

  /**
   * 프로젝트 루트 디렉토리 찾기
   *
   * package.json이 있는 디렉토리를 찾습니다.
   */
  private findProjectRoot(): string {
    let currentDir = __dirname;

    // 최대 5단계 상위로 탐색
    for (let i = 0; i < 5; i++) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }

    // 못 찾으면 현재 디렉토리 반환
    return process.cwd();
  }

  /**
   * 모든 Solidity 컨트랙트 컴파일
   *
   * contracts/ 디렉토리의 모든 .sol 파일을 컴파일합니다.
   *
   * @returns 컴파일 결과
   */
  async compileAll(): Promise<{
    success: boolean;
    contracts: Array<{
      name: string;
      bytecode: string;
      abi: any[];
      errors?: string[];
    }>;
    errors: string[];
  }> {
    this.logger.log('Starting Solidity compilation...');

    // contracts/ 디렉토리 확인
    if (!fs.existsSync(this.contractsDir)) {
      throw new Error(`Contracts directory not found: ${this.contractsDir}`);
    }

    // .sol 파일 찾기
    const solFiles = this.findSolFiles(this.contractsDir);
    if (solFiles.length === 0) {
      throw new Error(`No .sol files found in ${this.contractsDir}`);
    }

    this.logger.log(`Found ${solFiles.length} Solidity file(s)`);

    // 모든 파일 읽기
    const sources: { [key: string]: { content: string } } = {};
    for (const file of solFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(this.contractsDir, file);
      sources[relativePath] = { content };
    }

    // 컴파일 옵션
    const input = {
      language: 'Solidity',
      sources,
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode.object'],
          },
        },
        optimizer: {
          enabled: false, // 최적화 비활성화 (디버깅 용이)
          runs: 200,
        },
      },
    };

    // 컴파일 실행
    let output: any;
    try {
      const inputString = JSON.stringify(input);
      output = JSON.parse(solc.compile(inputString));
    } catch (error: any) {
      this.logger.error(`Compilation failed: ${error.message}`);
      throw new Error(`Compilation failed: ${error.message}`);
    }

    // 컴파일 결과 처리
    const contracts: Array<{
      name: string;
      bytecode: string;
      abi: any[];
      errors?: string[];
    }> = [];
    const errors: string[] = [];

    // 컴파일 에러 확인
    if (output.errors) {
      for (const error of output.errors) {
        if (error.severity === 'error') {
          errors.push(error.formattedMessage || error.message);
        } else if (error.severity === 'warning') {
          this.logger.warn(`Compilation warning: ${error.message}`);
        }
      }
    }

    // 컴파일된 컨트랙트 추출
    for (const [fileName, fileOutput] of Object.entries(output.contracts)) {
      for (const [contractName, contractOutput] of Object.entries(
        fileOutput as any,
      )) {
        const contract = contractOutput as any;
        const bytecode = contract.evm?.bytecode?.object || '';
        const abi = contract.abi || [];

        if (bytecode) {
          contracts.push({
            name: contractName,
            bytecode: `0x${bytecode}`,
            abi,
            errors: errors.length > 0 ? errors : undefined,
          });
        }
      }
    }

    // 결과 저장
    if (contracts.length > 0) {
      this.saveCompilationResults(contracts);
    }

    const success = errors.length === 0 && contracts.length > 0;

    if (success) {
      this.logger.log(
        `✅ Compilation successful: ${contracts.length} contract(s) compiled`,
      );
    } else {
      this.logger.error(
        `❌ Compilation failed: ${errors.length} error(s), ${contracts.length} contract(s) compiled`,
      );
    }

    return {
      success,
      contracts,
      errors,
    };
  }

  /**
   * 특정 컨트랙트 컴파일
   *
   * @param contractName 컴파일할 컨트랙트 이름 (파일명)
   * @returns 컴파일 결과
   */
  async compileContract(contractName: string): Promise<{
    success: boolean;
    contract?: {
      name: string;
      bytecode: string;
      abi: any[];
    };
    errors: string[];
  }> {
    const contractPath = path.join(this.contractsDir, `${contractName}.sol`);

    if (!fs.existsSync(contractPath)) {
      throw new Error(`Contract file not found: ${contractPath}`);
    }

    this.logger.log(`Compiling ${contractName}...`);

    // 파일 읽기
    const content = fs.readFileSync(contractPath, 'utf8');
    const sources = {
      [`${contractName}.sol`]: { content },
    };

    // 컴파일 옵션
    const input = {
      language: 'Solidity',
      sources,
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode.object'],
          },
        },
        optimizer: {
          enabled: false,
          runs: 200,
        },
      },
    };

    // 컴파일 실행
    let output: any;
    try {
      const inputString = JSON.stringify(input);
      output = JSON.parse(solc.compile(inputString));
    } catch (error: any) {
      this.logger.error(`Compilation failed: ${error.message}`);
      throw new Error(`Compilation failed: ${error.message}`);
    }

    // 에러 확인
    const errors: string[] = [];
    if (output.errors) {
      for (const error of output.errors) {
        if (error.severity === 'error') {
          errors.push(error.formattedMessage || error.message);
        }
      }
    }

    // 컨트랙트 추출
    const fileOutput = output.contracts[`${contractName}.sol`];
    if (!fileOutput || Object.keys(fileOutput).length === 0) {
      throw new Error(`No contract found in ${contractName}.sol`);
    }

    const contractNameInFile = Object.keys(fileOutput)[0];
    const contract = fileOutput[contractNameInFile];
    const bytecode = contract.evm?.bytecode?.object || '';
    const abi = contract.abi || [];

    if (!bytecode) {
      throw new Error(`No bytecode generated for ${contractName}`);
    }

    const result = {
      name: contractNameInFile,
      bytecode: `0x${bytecode}`,
      abi,
    };

    // 결과 저장
    this.saveCompilationResults([result]);

    this.logger.log(`✅ ${contractName} compiled successfully`);

    return {
      success: errors.length === 0,
      contract: result,
      errors,
    };
  }

  /**
   * .sol 파일 찾기
   *
   * @param dir 검색할 디렉토리
   * @returns .sol 파일 경로 배열
   */
  private findSolFiles(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && entry.name.endsWith('.sol')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 컴파일 결과 저장
   *
   * contract-bytecodes.json과 contract-abis.json에 저장합니다.
   *
   * ⚠️ 주의: 기존 데이터 구조를 보존합니다.
   * - address 필드가 있는 경우 유지
   * - 같은 이름의 컨트랙트만 업데이트 (덮어쓰기)
   * - 다른 필드들은 그대로 유지
   *
   * @param contracts 컴파일된 컨트랙트 배열
   */
  private saveCompilationResults(
    contracts: Array<{
      name: string;
      bytecode: string;
      abi: any[];
    }>,
  ): void {
    // 기존 파일 읽기 (있는 경우)
    let existingBytecodes: any = { contracts: [] };
    let existingABIs: any = { contracts: [] };

    if (fs.existsSync(this.bytecodesPath)) {
      try {
        const content = fs.readFileSync(this.bytecodesPath, 'utf8');
        existingBytecodes = JSON.parse(content);
        // contracts 배열이 없으면 초기화
        if (!existingBytecodes.contracts) {
          existingBytecodes.contracts = [];
        }
      } catch {
        this.logger.warn('Failed to read existing bytecodes file');
        existingBytecodes = { contracts: [] };
      }
    }

    if (fs.existsSync(this.abisPath)) {
      try {
        const content = fs.readFileSync(this.abisPath, 'utf8');
        existingABIs = JSON.parse(content);
        // contracts 배열이 없으면 초기화
        if (!existingABIs.contracts) {
          existingABIs.contracts = [];
        }
      } catch {
        this.logger.warn('Failed to read existing ABIs file');
        existingABIs = { contracts: [] };
      }
    }

    // 기존 컨트랙트 업데이트 또는 추가
    for (const contract of contracts) {
      // bytecodes에서 같은 이름 찾기
      const existingBytecodeIndex = existingBytecodes.contracts.findIndex(
        (c: any) => c.name === contract.name,
      );

      if (existingBytecodeIndex >= 0) {
        // 기존 컨트랙트 업데이트 (다른 필드들은 유지)
        existingBytecodes.contracts[existingBytecodeIndex] = {
          ...existingBytecodes.contracts[existingBytecodeIndex],
          name: contract.name,
          bytecode: contract.bytecode,
        };
      } else {
        // 새 컨트랙트 추가
        existingBytecodes.contracts.push({
          name: contract.name,
          bytecode: contract.bytecode,
        });
      }

      // ABIs에서 같은 이름 찾기
      const existingABIIndex = existingABIs.contracts.findIndex(
        (c: any) => c.name === contract.name,
      );

      if (existingABIIndex >= 0) {
        // 기존 컨트랙트 업데이트 (다른 필드들은 유지)
        existingABIs.contracts[existingABIIndex] = {
          ...existingABIs.contracts[existingABIIndex],
          name: contract.name,
          abi: contract.abi,
        };
      } else {
        // 새 컨트랙트 추가
        existingABIs.contracts.push({
          name: contract.name,
          abi: contract.abi,
        });
      }
    }

    // 파일 저장
    fs.writeFileSync(
      this.bytecodesPath,
      JSON.stringify(existingBytecodes, null, 2),
      'utf8',
    );
    fs.writeFileSync(
      this.abisPath,
      JSON.stringify(existingABIs, null, 2),
      'utf8',
    );

    this.logger.log(
      `Compilation results saved to ${this.bytecodesPath} and ${this.abisPath}`,
    );
  }

  /**
   * 컴파일 결과 조회
   *
   * @param contractName 컨트랙트 이름 (선택)
   * @returns 컴파일 결과
   */
  getCompilationResults(contractName?: string): {
    bytecodes: any;
    abis: any;
  } {
    let bytecodes: any = { contracts: [] };
    let abis: any = { contracts: [] };

    if (fs.existsSync(this.bytecodesPath)) {
      try {
        const content = fs.readFileSync(this.bytecodesPath, 'utf8');
        bytecodes = JSON.parse(content);
      } catch (error) {
        this.logger.warn('Failed to read bytecodes file');
      }
    }

    if (fs.existsSync(this.abisPath)) {
      try {
        const content = fs.readFileSync(this.abisPath, 'utf8');
        abis = JSON.parse(content);
      } catch (error) {
        this.logger.warn('Failed to read ABIs file');
      }
    }

    // 특정 컨트랙트만 조회
    if (contractName) {
      bytecodes.contracts = bytecodes.contracts.filter(
        (c: any) => c.name === contractName,
      );
      abis.contracts = abis.contracts.filter(
        (c: any) => c.name === contractName,
      );
    }

    return { bytecodes, abis };
  }
}
