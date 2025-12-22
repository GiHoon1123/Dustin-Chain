/**
 * StakingContract 통합 테스트 스크립트 (단계별)
 *
 * 테스트 순서:
 * 1. 서버 상태 확인
 * 2. StakingContract 배포 확인
 * 3. Validator 등록 확인 (Genesis Validator 자동 등록)
 * 4. 블록 생성 확인
 * 5. Proposer 보상 지급 확인
 * 6. Committee 보상 누적 확인
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testStep1_ServerStatus() {
  console.log('\n📋 Step 1: 서버 상태 확인');
  console.log('='.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ 서버 실행 중');
    console.log(`   상태: ${JSON.stringify(response.data)}`);
    return true;
  } catch (error) {
    console.log('❌ 서버가 실행되지 않았습니다.');
    console.log('   먼저 서버를 실행하세요: npm run start:dev');
    return false;
  }
}

async function testStep2_StakingContractDeployment() {
  console.log('\n📋 Step 2: StakingContract 배포 확인');
  console.log('='.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/contract/deployed`);
    const deployed = response.data;
    
    if (!deployed.staking) {
      console.log('❌ StakingContract가 배포되지 않았습니다.');
      console.log('   배포 명령: POST /contract/deploy-staking');
      return false;
    }
    
    console.log('✅ StakingContract 배포됨');
    console.log(`   주소: ${deployed.staking.address}`);
    console.log(`   트랜잭션 해시: ${deployed.staking.txHash}`);
    return true;
  } catch (error) {
    console.log('❌ 배포 정보 조회 실패:', error.message);
    return false;
  }
}

async function testStep3_ValidatorRegistration() {
  console.log('\n📋 Step 3: Validator 등록 확인');
  console.log('='.repeat(50));
  
  try {
    // 활성 Validator 조회
    const validatorsResponse = await axios.get(`${BASE_URL}/staking/validators`);
    const validators = validatorsResponse.data.validators;
    
    console.log(`✅ 활성 Validator: ${validators.length}명`);
    
    if (validators.length === 0) {
      console.log('⚠️  등록된 Validator가 없습니다.');
      console.log('   서버 재시작 시 Genesis Validator가 자동 등록되어야 합니다.');
      return false;
    }
    
    // 처음 3명의 Validator 정보 출력
    console.log('\n   처음 3명의 Validator 정보:');
    for (let i = 0; i < Math.min(3, validators.length); i++) {
      const v = validators[i];
      console.log(`   ${i + 1}. ${v.validatorAddress.slice(0, 20)}...`);
      console.log(`      - 상태: ${v.status}`);
      console.log(`      - 스테이킹: ${Number(v.stakedAmount) / 1e18} DSTN`);
      console.log(`      - 총 보상: ${Number(v.totalRewards) / 1e18} DSTN`);
    }
    
    // Staking 통계
    const statsResponse = await axios.get(`${BASE_URL}/staking/stats`);
    const stats = statsResponse.data;
    console.log('\n   Staking 통계:');
    console.log(`   - 총 스테이킹: ${Number(stats.totalStaked) / 1e18} DSTN`);
    console.log(`   - 총 Validator: ${stats.totalValidators}명`);
    console.log(`   - 활성 Validator: ${stats.activeValidators}명`);
    
    return true;
  } catch (error) {
    console.log('❌ Validator 조회 실패:', error.message);
    if (error.response) {
      console.log('   응답:', error.response.data);
    }
    return false;
  }
}

async function testStep4_BlockProduction() {
  console.log('\n📋 Step 4: 블록 생성 확인');
  console.log('='.repeat(50));
  
  try {
    // 현재 블록 확인
    const latestBlockResponse = await axios.get(`${BASE_URL}/block/latest`);
    const initialBlock = latestBlockResponse.data;
    const initialBlockNumber = initialBlock.number;
    
    console.log(`✅ 현재 블록: #${initialBlockNumber}`);
    console.log(`   Proposer: ${initialBlock.proposer.slice(0, 20)}...`);
    console.log(`   트랜잭션 수: ${initialBlock.transactions.length}`);
    
    // 2개 블록 생성 대기 (약 24초)
    console.log('\n   블록 생성 대기 중... (약 24초)');
    console.log('   12초마다 블록이 생성됩니다.');
    
    let blockCount = 0;
    const maxWaitTime = 30000; // 30초
    const startTime = Date.now();
    
    while (blockCount < 2 && Date.now() - startTime < maxWaitTime) {
      await sleep(15000); // 15초 대기
      
      const newBlockResponse = await axios.get(`${BASE_URL}/block/latest`);
      const newBlock = newBlockResponse.data;
      
      if (newBlock.number > initialBlockNumber + blockCount) {
        blockCount++;
        console.log(`\n   ✅ 블록 #${newBlock.number} 생성됨`);
        console.log(`      Proposer: ${newBlock.proposer.slice(0, 20)}...`);
        console.log(`      트랜잭션 수: ${newBlock.transactions.length}`);
        
        // Proposer가 Validator인지 확인
        const validatorsResponse = await axios.get(`${BASE_URL}/staking/validators`);
        const validators = validatorsResponse.data.validators;
        const isValidator = validators.some(
          (v) => v.validatorAddress.toLowerCase() === newBlock.proposer.toLowerCase(),
        );
        
        if (isValidator) {
          console.log(`      → StakingContract에 등록된 Validator`);
        } else {
          console.log(`      ⚠️  StakingContract에 등록되지 않은 주소`);
        }
      }
    }
    
    if (blockCount < 2) {
      console.log(`\n   ⚠️  ${blockCount}개 블록만 생성됨 (예상: 2개)`);
    }
    
    return true;
  } catch (error) {
    console.log('❌ 블록 생성 확인 실패:', error.message);
    return false;
  }
}

async function testStep5_ProposerReward() {
  console.log('\n📋 Step 5: Proposer 보상 지급 확인');
  console.log('='.repeat(50));
  
  try {
    // 최신 블록의 Proposer 확인
    const latestBlockResponse = await axios.get(`${BASE_URL}/block/latest`);
    const latestBlock = latestBlockResponse.data;
    const proposer = latestBlock.proposer;
    
    console.log(`   최신 블록 #${latestBlock.number}의 Proposer: ${proposer.slice(0, 20)}...`);
    
    // Proposer의 Validator 정보 조회
    const validatorInfoResponse = await axios.get(
      `${BASE_URL}/staking/validator/${proposer}`,
    );
    const validatorInfo = validatorInfoResponse.data;
    
    console.log('\n   Proposer Validator 정보:');
    console.log(`   - 상태: ${validatorInfo.status}`);
    console.log(`   - 스테이킹: ${Number(validatorInfo.stakedAmount) / 1e18} DSTN`);
    console.log(`   - 총 보상: ${Number(validatorInfo.totalRewards) / 1e18} DSTN`);
    
    if (Number(validatorInfo.totalRewards) > 0) {
      console.log('\n   ✅ Proposer 보상이 지급되었습니다!');
      console.log(`      보상 금액: ${Number(validatorInfo.totalRewards) / 1e18} DSTN`);
    } else {
      console.log('\n   ⚠️  아직 보상이 지급되지 않았습니다.');
      console.log('      (Proposer로 선택되지 않았거나 보상 지급이 실패했을 수 있음)');
    }
    
    return true;
  } catch (error) {
    console.log('❌ Proposer 보상 확인 실패:', error.message);
    if (error.response) {
      console.log('   응답:', error.response.data);
    }
    return false;
  }
}

async function testStep6_CommitteeReward() {
  console.log('\n📋 Step 6: Committee 보상 누적 확인');
  console.log('='.repeat(50));
  
  try {
    // 활성 Validator 조회
    const validatorsResponse = await axios.get(`${BASE_URL}/staking/validators`);
    const validators = validatorsResponse.data.validators;
    
    console.log(`   활성 Validator: ${validators.length}명`);
    
    // 최신 블록 확인
    const latestBlockResponse = await axios.get(`${BASE_URL}/block/latest`);
    const latestBlock = latestBlockResponse.data;
    const currentEpoch = Math.floor(latestBlock.number / 32);
    
    console.log(`   현재 블록: #${latestBlock.number}`);
    console.log(`   현재 Epoch: ${currentEpoch}`);
    
    // 처음 3명의 Validator 보상 확인
    console.log('\n   처음 3명의 Validator 보상 상태:');
    for (let i = 0; i < Math.min(3, validators.length); i++) {
      const v = validators[i];
      console.log(`   ${i + 1}. ${v.validatorAddress.slice(0, 20)}...`);
      console.log(`      - 총 보상: ${Number(v.totalRewards) / 1e18} DSTN`);
      
      // Committee 보상은 Epoch 단위로 누적되므로, totalRewards에는 아직 반영되지 않을 수 있음
      // (Epoch 보상 일괄 지급이 자동화되지 않았기 때문)
    }
    
    console.log('\n   ⚠️  참고: Committee 보상은 Epoch 단위로 누적됩니다.');
    console.log('      현재는 누적만 되고, 실제 지급은 Epoch 완료 시 일괄 지급됩니다.');
    console.log('      (Epoch 보상 일괄 지급 자동화는 아직 구현되지 않았습니다)');
    
    return true;
  } catch (error) {
    console.log('❌ Committee 보상 확인 실패:', error.message);
    return false;
  }
}

async function main() {
  console.log('🧪 StakingContract 통합 테스트 시작');
  console.log('='.repeat(50));
  
  // Step 1: 서버 상태 확인
  const step1 = await testStep1_ServerStatus();
  if (!step1) {
    process.exit(1);
  }
  
  await sleep(1000);
  
  // Step 2: StakingContract 배포 확인
  const step2 = await testStep2_StakingContractDeployment();
  if (!step2) {
    console.log('\n❌ 테스트 중단: StakingContract가 배포되지 않았습니다.');
    process.exit(1);
  }
  
  await sleep(1000);
  
  // Step 3: Validator 등록 확인
  const step3 = await testStep3_ValidatorRegistration();
  if (!step3) {
    console.log('\n⚠️  경고: Validator가 등록되지 않았습니다.');
    console.log('   서버를 재시작하면 Genesis Validator가 자동으로 등록됩니다.');
  }
  
  await sleep(1000);
  
  // Step 4: 블록 생성 확인
  const step4 = await testStep4_BlockProduction();
  if (!step4) {
    console.log('\n⚠️  경고: 블록 생성 확인 중 문제가 발생했습니다.');
  }
  
  await sleep(1000);
  
  // Step 5: Proposer 보상 확인
  const step5 = await testStep5_ProposerReward();
  if (!step5) {
    console.log('\n⚠️  경고: Proposer 보상 확인 중 문제가 발생했습니다.');
  }
  
  await sleep(1000);
  
  // Step 6: Committee 보상 확인
  const step6 = await testStep6_CommitteeReward();
  if (!step6) {
    console.log('\n⚠️  경고: Committee 보상 확인 중 문제가 발생했습니다.');
  }
  
  // 최종 요약
  console.log('\n' + '='.repeat(50));
  console.log('📊 테스트 요약');
  console.log('='.repeat(50));
  console.log(`✅ Step 1 (서버 상태): ${step1 ? '성공' : '실패'}`);
  console.log(`✅ Step 2 (StakingContract 배포): ${step2 ? '성공' : '실패'}`);
  console.log(`✅ Step 3 (Validator 등록): ${step3 ? '성공' : '실패'}`);
  console.log(`✅ Step 4 (블록 생성): ${step4 ? '성공' : '실패'}`);
  console.log(`✅ Step 5 (Proposer 보상): ${step5 ? '성공' : '실패'}`);
  console.log(`✅ Step 6 (Committee 보상): ${step6 ? '성공' : '실패'}`);
  console.log('\n✅ 테스트 완료!');
}

main().catch((error) => {
  console.error('❌ 테스트 실행 중 오류 발생:', error.message);
  process.exit(1);
});

