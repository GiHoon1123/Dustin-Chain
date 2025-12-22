// 컴파일 테스트 스크립트
// 컴파일 후 JSON 파일에 잘 저장되는지 확인

const solc = require('solc');
const fs = require('fs');
const path = require('path');

console.log('🧪 컴파일 테스트 시작...\n');

const contractsDir = path.join(__dirname, 'contracts');
const bytecodesPath = path.join(__dirname, 'contract-bytecodes.json');
const abisPath = path.join(__dirname, 'contract-abis.json');

// 기존 파일 백업
let originalBytecodes = null;
let originalABIs = null;

if (fs.existsSync(bytecodesPath)) {
  originalBytecodes = fs.readFileSync(bytecodesPath, 'utf8');
  console.log('✅ 기존 contract-bytecodes.json 백업 완료');
}

if (fs.existsSync(abisPath)) {
  originalABIs = fs.readFileSync(abisPath, 'utf8');
  console.log('✅ 기존 contract-abis.json 백업 완료');
}

console.log('');

// .sol 파일 찾기
const solFiles = fs.readdirSync(contractsDir).filter(f => f.endsWith('.sol'));
console.log(`📁 발견된 컨트랙트 파일: ${solFiles.length}개\n`);

// 모든 파일 읽기
const sources = {};
for (const file of solFiles) {
  const filePath = path.join(contractsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  sources[file] = { content };
  console.log(`  ✓ ${file}`);
}

console.log('\n🔨 컴파일 중...\n');

// 컴파일 입력
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
let output;
try {
  const inputString = JSON.stringify(input);
  output = JSON.parse(solc.compile(inputString));
} catch (error) {
  console.error('❌ 컴파일 실패:', error.message);
  process.exit(1);
}

// 에러 확인
if (output.errors) {
  const errors = output.errors.filter(e => e.severity === 'error');
  const warnings = output.errors.filter(e => e.severity === 'warning');

  if (errors.length > 0) {
    console.error('❌ 컴파일 에러:\n');
    errors.forEach(err => {
      console.error(`  ${err.formattedMessage || err.message}`);
    });
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('⚠️  컴파일 경고:\n');
    warnings.forEach(warn => {
      console.warn(`  ${warn.message}`);
    });
    console.log('');
  }
}

// 컴파일 결과 추출
const contracts = [];
for (const [fileName, fileOutput] of Object.entries(output.contracts)) {
  for (const [contractName, contractOutput] of Object.entries(fileOutput)) {
    const contract = contractOutput;
    const bytecode = contract.evm?.bytecode?.object || '';
    const abi = contract.abi || [];

    if (bytecode) {
      contracts.push({
        name: contractName,
        bytecode: `0x${bytecode}`,
        abi,
      });
      console.log(`✅ ${contractName} 컴파일 성공`);
      console.log(`   - Bytecode 길이: ${bytecode.length} bytes`);
      console.log(`   - ABI 항목 수: ${abi.length}\n`);
    }
  }
}

if (contracts.length === 0) {
  console.error('❌ 컴파일된 컨트랙트가 없습니다.');
  process.exit(1);
}

// 기존 파일 읽기
let existingBytecodes = { contracts: [] };
let existingABIs = { contracts: [] };

if (fs.existsSync(bytecodesPath)) {
  try {
    const content = fs.readFileSync(bytecodesPath, 'utf8');
    existingBytecodes = JSON.parse(content);
    if (!existingBytecodes.contracts) {
      existingBytecodes.contracts = [];
    }
    console.log(`📖 기존 bytecodes 파일 읽기: ${existingBytecodes.contracts.length}개 컨트랙트`);
  } catch (error) {
    console.warn('⚠️  기존 bytecodes 파일 읽기 실패, 새로 생성합니다.');
  }
}

if (fs.existsSync(abisPath)) {
  try {
    const content = fs.readFileSync(abisPath, 'utf8');
    existingABIs = JSON.parse(content);
    if (!existingABIs.contracts) {
      existingABIs.contracts = [];
    }
    console.log(`📖 기존 ABIs 파일 읽기: ${existingABIs.contracts.length}개 컨트랙트`);
  } catch (error) {
    console.warn('⚠️  기존 ABIs 파일 읽기 실패, 새로 생성합니다.');
  }
}

console.log('');

// 기존 컨트랙트 업데이트 또는 추가
for (const contract of contracts) {
  // bytecodes에서 같은 이름 찾기
  const existingBytecodeIndex = existingBytecodes.contracts.findIndex(
    (c) => c.name === contract.name,
  );

  if (existingBytecodeIndex >= 0) {
    // 기존 컨트랙트 업데이트 (다른 필드들은 유지)
    const existing = existingBytecodes.contracts[existingBytecodeIndex];
    existingBytecodes.contracts[existingBytecodeIndex] = {
      ...existing,
      name: contract.name,
      bytecode: contract.bytecode,
    };
    console.log(`🔄 ${contract.name} bytecode 업데이트 (기존 필드 유지)`);
  } else {
    // 새 컨트랙트 추가
    existingBytecodes.contracts.push({
      name: contract.name,
      bytecode: contract.bytecode,
    });
    console.log(`➕ ${contract.name} bytecode 추가`);
  }

  // ABIs에서 같은 이름 찾기
  const existingABIIndex = existingABIs.contracts.findIndex(
    (c) => c.name === contract.name,
  );

  if (existingABIIndex >= 0) {
    // 기존 컨트랙트 업데이트 (다른 필드들은 유지)
    const existing = existingABIs.contracts[existingABIIndex];
    existingABIs.contracts[existingABIIndex] = {
      ...existing,
      name: contract.name,
      abi: contract.abi,
    };
    console.log(`🔄 ${contract.name} ABI 업데이트 (기존 필드 유지)`);
  } else {
    // 새 컨트랙트 추가
    existingABIs.contracts.push({
      name: contract.name,
      abi: contract.abi,
    });
    console.log(`➕ ${contract.name} ABI 추가`);
  }
}

console.log('');

// 파일 저장
fs.writeFileSync(
  bytecodesPath,
  JSON.stringify(existingBytecodes, null, 2),
  'utf8',
);
fs.writeFileSync(
  abisPath,
  JSON.stringify(existingABIs, null, 2),
  'utf8',
);

console.log('💾 저장 완료:');
console.log(`   - ${bytecodesPath}`);
console.log(`   - ${abisPath}\n`);

// 저장된 파일 검증
console.log('🔍 저장된 파일 검증 중...\n');

try {
  const savedBytecodes = JSON.parse(fs.readFileSync(bytecodesPath, 'utf8'));
  const savedABIs = JSON.parse(fs.readFileSync(abisPath, 'utf8'));

  console.log(`✅ contract-bytecodes.json 검증 성공:`);
  console.log(`   - 총 ${savedBytecodes.contracts.length}개 컨트랙트`);
  for (const contract of contracts) {
    const found = savedBytecodes.contracts.find((c) => c.name === contract.name);
    if (found) {
      console.log(`   ✓ ${contract.name}: bytecode 저장됨 (${found.bytecode.length} chars)`);
      // 기존 필드 확인
      if (found.address) {
        console.log(`     → 기존 address 필드 유지: ${found.address}`);
      }
    } else {
      console.log(`   ❌ ${contract.name}: bytecode 저장 실패!`);
    }
  }

  console.log(`\n✅ contract-abis.json 검증 성공:`);
  console.log(`   - 총 ${savedABIs.contracts.length}개 컨트랙트`);
  for (const contract of contracts) {
    const found = savedABIs.contracts.find((c) => c.name === contract.name);
    if (found) {
      console.log(`   ✓ ${contract.name}: ABI 저장됨 (${found.abi.length} 항목)`);
      // 기존 필드 확인
      if (found.address) {
        console.log(`     → 기존 address 필드 유지: ${found.address}`);
      }
    } else {
      console.log(`   ❌ ${contract.name}: ABI 저장 실패!`);
    }
  }

  console.log('\n✅ 모든 검증 완료!');
} catch (error) {
  console.error('❌ 파일 검증 실패:', error.message);
  // 원래 파일 복구
  if (originalBytecodes) {
    fs.writeFileSync(bytecodesPath, originalBytecodes, 'utf8');
    console.log('🔄 원래 bytecodes 파일 복구');
  }
  if (originalABIs) {
    fs.writeFileSync(abisPath, originalABIs, 'utf8');
    console.log('🔄 원래 ABIs 파일 복구');
  }
  process.exit(1);
}

console.log('\n✅ 컴파일 테스트 성공!');

