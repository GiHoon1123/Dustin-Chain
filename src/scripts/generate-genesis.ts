import * as fs from 'fs';
import * as path from 'path';

/**
 * genesis.json 생성 스크립트
 *
 * 이더리움:
 * - Genesis 블록 초기 설정
 * - alloc: 초기 계정 잔액 할당
 */
interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

interface GenesisConfig {
  config: {
    chainId: number;
    blockTime: number;
    epochSize: number;
  };
  timestamp: string;
  extraData: string;
  alloc: {
    [address: string]: {
      balance: string;
    };
  };
}

const ACCOUNTS_FILE = 'genesis-accounts.json';
const OUTPUT_FILE = 'genesis.json';
const INITIAL_BALANCE = '50000000000000000000'; // 50 DSTN in Wei

/**
 * genesis.json 생성
 */
function generateGenesis(): void {
  console.log('=== Dustin-Chain Genesis Generator ===\n');

  // 1. genesis-accounts.json 읽기
  const rootDir = path.resolve(__dirname, '..');
  const accountsPath = path.join(rootDir, ACCOUNTS_FILE);

  if (!fs.existsSync(accountsPath)) {
    console.error(`Error: ${ACCOUNTS_FILE} not found`);
    console.log('Run: npm run generate:accounts first');
    process.exit(1);
  }

  const accountsContent = fs.readFileSync(accountsPath, 'utf8');
  const accounts: GenesisAccount[] = JSON.parse(accountsContent);

  console.log(`Loaded ${accounts.length} accounts from ${ACCOUNTS_FILE}`);

  // 2. alloc 객체 생성
  const alloc: { [address: string]: { balance: string } } = {};

  for (const account of accounts) {
    alloc[account.address] = {
      balance: INITIAL_BALANCE,
    };
  }

  console.log(`Created alloc for ${Object.keys(alloc).length} accounts`);
  console.log(
    `Initial balance per account: ${INITIAL_BALANCE} Wei (50 DSTN)\n`,
  );

  // 3. genesis config 생성
  const genesis: GenesisConfig = {
    config: {
      chainId: 999,
      blockTime: 12000,
      epochSize: 32,
    },
    timestamp: '0',
    extraData: 'Dustin-Chain Genesis Block',
    alloc,
  };

  // 4. genesis.json 저장
  const outputPath = path.join(rootDir, OUTPUT_FILE);
  const jsonContent = JSON.stringify(genesis, null, 2);
  fs.writeFileSync(outputPath, jsonContent, 'utf8');

  console.log(`Genesis config saved to: ${outputPath}`);
  console.log('\n=== Summary ===');
  console.log(`Chain ID: ${genesis.config.chainId}`);
  console.log(`Block Time: ${genesis.config.blockTime}ms`);
  console.log(`Epoch Size: ${genesis.config.epochSize} blocks`);
  console.log(`Total Accounts: ${Object.keys(alloc).length}`);
  console.log(
    `Total Supply: ${BigInt(INITIAL_BALANCE) * BigInt(accounts.length)} Wei`,
  );
  console.log(`             = ${accounts.length * 50} DSTN`);
  console.log('\n✓ Successfully generated genesis.json');
}

try {
  generateGenesis();
} catch (error) {
  console.error('Error generating genesis:', error);
  process.exit(1);
}
