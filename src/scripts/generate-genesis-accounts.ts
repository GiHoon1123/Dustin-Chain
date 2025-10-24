import * as fs from 'fs';
import * as path from 'path';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * Genesis 계정 생성 스크립트
 *
 * 이더리움:
 * - Genesis 블록에 초기 잔액 할당
 * - ICO 참여자, 창시자, 재단 등
 */
interface GenesisAccount {
  index: number;
  address: string;
  publicKey: string;
  privateKey: string;
}

const ACCOUNT_COUNT = 256;
const OUTPUT_FILE = 'genesis-accounts.json';

/**
 * 256개 계정 생성
 *
 * 이더리움:
 * - secp256k1 타원곡선
 * - 개인키 -> 공개키 -> 주소
 */
function generateAccounts(): GenesisAccount[] {
  const cryptoService = new CryptoService();
  const accounts: GenesisAccount[] = [];

  console.log(`Generating ${ACCOUNT_COUNT} genesis accounts...`);

  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const keyPair = cryptoService.generateKeyPair();

    accounts.push({
      index: i,
      address: keyPair.address,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    });

    if ((i + 1) % 50 === 0 || i === ACCOUNT_COUNT - 1) {
      console.log(`  Generated ${i + 1}/${ACCOUNT_COUNT} accounts`);
    }
  }

  return accounts;
}

function saveToFile(accounts: GenesisAccount[], filename: string): void {
  const rootDir = path.resolve(__dirname, '..');
  const outputPath = path.join(rootDir, filename);
  const jsonContent = JSON.stringify(accounts, null, 2);

  fs.writeFileSync(outputPath, jsonContent, 'utf8');

  console.log(`\nAccounts saved to: ${outputPath}`);
  console.log(`Total accounts: ${accounts.length}`);
}

function printStats(accounts: GenesisAccount[]): void {
  console.log('\n=== Statistics ===');
  console.log(`Total accounts: ${accounts.length}`);
  console.log(`\nFirst account:`);
  console.log(`  Index: ${accounts[0].index}`);
  console.log(`  Address: ${accounts[0].address}`);
  console.log(`  Public Key: ${accounts[0].publicKey.slice(0, 20)}...`);
  console.log(`  Private Key: ${accounts[0].privateKey.slice(0, 20)}...`);
  console.log(`\nLast account:`);
  const last = accounts[accounts.length - 1];
  console.log(`  Index: ${last.index}`);
  console.log(`  Address: ${last.address}`);
  console.log(`  Public Key: ${last.publicKey.slice(0, 20)}...`);
  console.log(`  Private Key: ${last.privateKey.slice(0, 20)}...`);
}

function main(): void {
  console.log('=== Dustin-Chain Genesis Accounts Generator ===\n');

  try {
    const accounts = generateAccounts();
    saveToFile(accounts, OUTPUT_FILE);
    printStats(accounts);

    console.log('\n✓ Successfully generated genesis accounts');
    console.log(
      '⚠ WARNING: Keep genesis-accounts.json secure (contains private keys)',
    );
  } catch (error) {
    console.error('Error generating accounts:', error);
    process.exit(1);
  }
}

main();
