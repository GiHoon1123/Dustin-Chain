#!/bin/bash

# 컨트랙트 메소드 호출 테스트 스크립트

echo "=== 컨트랙트 메소드 호출 테스트 ==="
echo ""

# 1. 간단한 컨트랙트 배포 (Counter 예제)
echo "1. 간단한 Counter 컨트랙트 배포..."

# 간단한 Counter 컨트랙트 바이트코드 (Solidity 0.8.x)
# pragma solidity ^0.8.0;
# contract Counter {
#     uint256 public value;
#     function setValue(uint256 _value) public { value = _value; }
#     function getValue() public view returns (uint256) { return value; }
# }

# 컴파일된 바이트코드 (간단한 버전)
COUNTER_BYTECODE="0x6080604052348015600e575f5ffd5b50600436106030575f3560e01c80632e64cec11460345780636057361d14604e575b5f5ffd5b603a6066565b60405160459190608d565b60405180910390f35b606460048036038101906060919060cd565b606e565b005b5f5f54905090565b805f8190555050565b5f819050919050565b6087816077565b82525050565b5f602082019050609e5f8301846080565b92915050565b5f5ffd5b60af816077565b811460b8575f5ffd5b50565b5f8135905060c78160a8565b92915050565b5f6020828403121560df5760de60a4565b5b5f60ea8482850160bb565b9150509291505056fea264697066735822122063f96a57b86a37af1ac0fbf522233470beb0ae3e330dcafa317cb897259fa87364736f6c634300081e0033"

# 계정 정보 가져오기
ACC=$(cat genesis-accounts.json | python3 -c "import sys, json; acc = json.load(sys.stdin)[6]; print(acc['address'])")
PK=$(cat genesis-accounts.json | python3 -c "import sys, json; acc = json.load(sys.stdin)[6]; print(acc['privateKey'])")

echo "사용 계정: $ACC"
echo ""

# 트랜잭션 서명
echo "트랜잭션 서명 중..."
SIGNED=$(curl -s -X POST http://localhost:3000/transaction/sign \
  -H "Content-Type: application/json" \
  -d "{
    \"privateKey\": \"$PK\",
    \"to\": null,
    \"value\": \"0\",
    \"gasPrice\": \"1000000000\",
    \"gasLimit\": \"3000000\",
    \"data\": \"$COUNTER_BYTECODE\"
  }")

# 트랜잭션 제출
echo "$SIGNED" | python3 -c "
import sys, json
data = json.load(sys.stdin)
send_data = {k:v for k,v in data.items() if k in ['from','to','value','nonce','gasPrice','gasLimit','data','v','r','s']}
import json as j
print(j.dumps(send_data))
" > /tmp/counter_deploy.json

TX_RESULT=$(curl -s -X POST http://localhost:3000/transaction/send \
  -H "Content-Type: application/json" \
  -d @/tmp/counter_deploy.json)

TX_HASH=$(echo "$TX_RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin)['hash'])")
echo "배포 트랜잭션 해시: $TX_HASH"
echo "블록 생성 대기 중... (30초)"
sleep 30

# Receipt 확인
RECEIPT=$(curl -s "http://localhost:3000/transaction/$TX_HASH/receipt")
CONTRACT_ADDR=$(echo "$RECEIPT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('contractAddress', 'null'))")
STATUS=$(echo "$RECEIPT" | python3 -c "import sys, json; r=json.load(sys.stdin); print(r.get('status', 'unknown'))")

echo ""
echo "=== 배포 결과 ==="
echo "컨트랙트 주소: $CONTRACT_ADDR"
echo "Status: $STATUS"
echo ""

if [ "$CONTRACT_ADDR" = "null" ] || [ "$STATUS" != "0x1" ]; then
  echo "❌ 컨트랙트 배포 실패"
  exit 1
fi

echo "✅ 컨트랙트 배포 성공!"
echo ""

# 2. 함수 선택자 계산 및 메소드 호출 테스트
echo "=== 메소드 호출 테스트 ==="
echo ""

# getValue() 함수 선택자 계산 (Keccak-256("getValue()")의 첫 4바이트)
# getValue() = 0x55241077
GET_VALUE_SELECTOR="0x55241077"

echo "함수: getValue()"
echo "선택자: $GET_VALUE_SELECTOR"
echo ""

# eth_call 호출
echo "POST /contract/call 호출 중..."
CALL_RESULT=$(curl -s -X POST http://localhost:3000/contract/call \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"$CONTRACT_ADDR\",
    \"data\": \"$GET_VALUE_SELECTOR\",
    \"from\": \"$ACC\"
  }")

echo "호출 결과:"
echo "$CALL_RESULT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
result = r.get('result', '')
gasUsed = r.get('gasUsed', '')
print(f\"  Result: {result}\")
print(f\"  Gas Used: {gasUsed}\")
if result and result != '0x':
    # uint256 디코딩 (32바이트 = 64 hex chars)
    if len(result) >= 66:  # 0x + 64 chars
        value_hex = result[2:66]
        value = int(value_hex, 16)
        print(f\"  Decoded Value: {value}\")
    else:
        print(f\"  Raw: {result}\")
"

echo ""
echo "✅ 테스트 완료!"


