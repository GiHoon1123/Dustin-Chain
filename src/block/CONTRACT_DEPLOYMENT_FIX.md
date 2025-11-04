# 컨트랙트 배포 실패 문제 해결 문서

## 개요

컨트랙트 배포 트랜잭션 실행 중 두 가지 주요 문제가 발생하여 배포가 실패했습니다. 각 문제의 원인을 분석하고 해결 방법을 문서화합니다.

## 문제 1: `0x-1` 에러 (hex string expected, got non-hex character "-1")

### 에러 메시지
```
Cannot convert string to buffer. toBuffer only supports 0x-prefixed hex strings and this string was given: 0x-1
```
또는
```
hex string expected, got non-hex character "-1"
```

### 발생 위치
- `@ethereumjs/vm` 내부: `EVM._generateAddress` 메서드
- 컨트랙트 주소 생성 과정에서 발생

### 근본 원인 분석

컨트랙트 주소 생성 로직 (`EVM._generateAddress`):

```typescript
// VM 내부 로직 (의사 코드)
async _generateAddress(message) {
  let acc = await this.stateManager.getAccount(message.caller);
  if (!acc) {
    acc = new Account(); // nonce = 0
  }
  
  // 문제 발생 지점
  let newNonce = acc.nonce - 1n; // 계정 nonce가 0이면 -1이 됨
  
  // 이 부분에서 에러 발생
  const addr = util.generateAddress(
    message.caller.bytes,
    util.bigIntToBytes(newNonce) // newNonce가 -1이면 "0x-1" 생성 시도
  );
}
```

문제 시나리오:
1. 새로운 계정(nonce=0)이 첫 컨트랙트 배포 트랜잭션 실행
2. VM이 컨트랙트 주소 생성 시 `acc.nonce - 1` 계산
3. `newNonce = 0 - 1 = -1` (음수 bigint)
4. `bigIntToBytes(-1)` 호출 시 음수를 처리하려 하며 내부적으로 문자열 "-1" 생성
5. `hexToBytes("-1")` 호출 시 hex 문자열이 아니어서 에러 발생

### 해결 방법

VM의 `_generateAddress` 메서드를 런타임에 패치하여 음수 nonce를 처리:

```typescript
// src/block/block.service.ts
this.vm = await createVM({
  stateManager: this.evmState as unknown as StateManagerInterface,
  common: this.common,
});

// VM 버그 수정: VM._generateAddress에서 acc.nonce - 1을 계산하는데,
// nonce가 0이면 -1이 되어 bigIntToBytes(-1)에서 에러 발생
// 해결: VM.evm._generateAddress를 패치하여 음수를 0으로 처리
(this.vm.evm as any)._generateAddress = async function (message: any) {
  let acc = await this.stateManager.getAccount(message.caller);
  if (!acc) {
    const { Account } = require('@ethereumjs/util');
    acc = new (Account as any)();
  }
  let newNonce = acc.nonce - 1n;
  
  // 음수인 경우 0으로 처리 (첫 컨트랙트 배포 시 nonce=0이면 -1이 됨)
  if (newNonce < 0n) {
    newNonce = 0n;
  }
  
  const util = require('@ethereumjs/util');
  let addr: Uint8Array;
  if (message.salt) {
    addr = util.generateAddress2(
      message.caller.bytes,
      message.salt,
      message.code,
    );
  } else {
    addr = util.generateAddress(
      message.caller.bytes,
      util.bigIntToBytes(newNonce), // 이제 항상 0 이상
    );
  }
  return new util.Address(addr);
}.bind(this.vm.evm);
```

패치 효과:
- `newNonce`가 음수일 경우 `0n`으로 강제 변환
- 첫 컨트랙트 배포(nonce=0) 시에도 정상 동작
- 이더리움 표준과 호환 (첫 배포 시 nonce 0 사용)

### 대안 시도 (실패)

1. CustomStateManager에서 nonce 조정:
   - `getAccount`에서 nonce + 1 반환
   - `toOurAccount`에서 nonce - 1 저장
   - 문제: VM 내부 nonce 검증 실패 (예상 nonce와 불일치)

2. `bigIntToBytes` 직접 패치:
   - `util.bigIntToBytes`를 재정의하려 시도
   - 문제: getter 속성이라 직접 재할당 불가능

최종 해결책인 런타임 패치가 가장 안전하고 효과적이었습니다.

## 문제 2: contractAddress 바이너리 문자열 저장 문제

### 문제 현상

Receipt 조회 시 `contractAddress`가 이상한 바이너리 문자열로 표시:

```json
{
  "contractAddress": "pKZŸbYpI\u001c_L"
}
```

정상적인 경우:
```json
{
  "contractAddress": "0xeab9704bc75ac5b86259af7049a91c81fcd15f4c"
}
```

### 발생 위치

- Receipt 저장/조회 과정
- `BlockLevelDBRepository.deserializeReceipt` 메서드

### 근본 원인 분석

RLP 직렬화/역직렬화 과정에서의 타입 처리 오류:

```typescript
// serializeReceipt (저장)
const rlpData = [
  receipt.transactionHash,
  receipt.transactionIndex.toString(),
  // ...
  receipt.contractAddress || '', // 문자열로 저장
  // ...
];
const rlpEncoded = this.cryptoService.rlpEncode(rlpData);
```

```typescript
// deserializeReceipt (조회) - 문제 코드
const [
  // ...
  contractAddress,
  // ...
] = rlpData; // RLP 디코딩된 결과

// 문제: RLP 디코딩 시 contractAddress는 Buffer 타입
receipt.contractAddress = contractAddress.toString(); // UTF-8로 해석하여 바이너리 문자열 생성
```

문제 시나리오:
1. Receipt 저장 시 `contractAddress`를 문자열로 RLP 인코딩
2. RLP 디코딩 시 문자열이 Buffer로 변환됨
3. Buffer를 `toString()` (기본 UTF-8)로 변환
4. 20바이트 주소 데이터가 UTF-8 문자열로 잘못 해석됨
5. 결과적으로 이상한 문자들로 표시됨

예시:
- 정상 주소: `0xeab9704bc75ac5b86259af7049a91c81fcd15f4c`
- 20바이트 hex를 UTF-8로 해석: `\xea\xb9\x70...` → `pK...`

### 해결 방법

RLP 역직렬화 시 Buffer를 hex 문자열로 직접 변환:

```typescript
// src/storage/repositories/block-leveldb.repository.ts
private deserializeReceipt(data: Buffer): TransactionReceipt {
  // ...
  const [
    // ...
    contractAddress,
    // ...
  ] = rlpData;

  // contractAddress 처리: RLP 디코딩된 값은 Buffer나 string일 수 있음
  // Buffer인 경우 UTF-8이 아닌 hex로 변환해야 함 (20바이트 주소)
  if (contractAddress) {
    // Buffer나 Uint8Array는 직접 hex로 변환
    if (Buffer.isBuffer(contractAddress) || contractAddress instanceof Uint8Array) {
      receipt.contractAddress = this.ensureHexString(contractAddress);
    } else if (typeof contractAddress === 'string') {
      // 이미 문자열인 경우, 0x 접두사 확인
      receipt.contractAddress =
        contractAddress.startsWith('0x')
          ? contractAddress
          : contractAddress.length > 0
            ? this.ensureHexString(Buffer.from(contractAddress, 'utf8'))
            : null;
    } else {
      // 다른 타입인 경우 toString() 후 처리
      const addrStr = contractAddress.toString();
      receipt.contractAddress =
        addrStr && addrStr.length > 0 && addrStr !== ''
          ? this.ensureHexString(addrStr)
          : null;
    }
    // 빈 문자열이거나 0x0 등은 null로 처리
    if (
      receipt.contractAddress === '' ||
      receipt.contractAddress === '0x' ||
      receipt.contractAddress === '0x0'
    ) {
      receipt.contractAddress = null;
    }
  } else {
    receipt.contractAddress = null;
  }
  // ...
}

// ensureHexString: Buffer/Uint8Array를 hex 문자열로 변환
private ensureHexString(value: any): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return this.cryptoService.bytesToHex(value); // 직접 hex로 변환
  }
  return value.toString();
}
```

추가로 `contractAddress` 추출 시 검증 로직 추가:

```typescript
// src/block/block.service.ts
if (created) {
  // Address 타입 처리: string, Address 객체, Uint8Array, Buffer 등
  if (typeof created === 'string') {
    contractAddress = created;
  } else if (created && typeof created === 'object') {
    if ('toString' in created) {
      const addrStr = (created as { toString: () => string }).toString();
      // toString()이 올바른 0x 접두사 주소를 반환하는지 확인
      contractAddress =
        addrStr && addrStr.startsWith('0x') ? addrStr : null;
    } else if ('bytes' in created) {
      const bytes = (created as { bytes: Uint8Array | Buffer }).bytes;
      contractAddress = this.cryptoService.bytesToHex(Buffer.from(bytes));
    } else {
      contractAddress = this.cryptoService.bytesToHex(
        Buffer.from(created as unknown as Uint8Array),
      );
    }
  } else {
    contractAddress = this.cryptoService.bytesToHex(
      Buffer.from(created as unknown as Uint8Array),
    );
  }
  
  // 최종 검증: contractAddress가 유효한 0x 접두사 주소인지 확인
  if (contractAddress && !contractAddress.startsWith('0x')) {
    this.logger.warn(
      `[VM] Invalid contract address format: ${contractAddress}, converting...`,
    );
    contractAddress = `0x${contractAddress}`;
  }
  // 20바이트 (40 hex chars) 길이 확인
  if (contractAddress && contractAddress.length !== 42) {
    this.logger.warn(
      `[VM] Contract address has unexpected length: ${contractAddress.length}, address: ${contractAddress}`,
    );
  }
}
```

해결 효과:
- RLP 디코딩된 Buffer를 올바르게 hex 문자열로 변환
- `contractAddress`가 항상 `0x` 접두사를 가진 42자리 hex 문자열
- 이전에 잘못 저장된 데이터도 조회 시 정상 표시

## 해결 과정 요약

### 단계 1: 문제 인식
- 컨트랙트 배포 트랜잭션 실행 시 `0x-1` 에러 발생
- Receipt 조회 시 `contractAddress`가 바이너리 문자열로 표시

### 단계 2: 원인 분석
- VM 내부 `_generateAddress`에서 음수 nonce 처리 문제
- RLP 역직렬화 시 Buffer를 UTF-8 문자열로 잘못 해석

### 단계 3: 해결 시도
- CustomStateManager nonce 조정 (실패: VM 검증 실패)
- `bigIntToBytes` 직접 패치 (실패: getter 속성)
- VM `_generateAddress` 런타임 패치 (성공)
- RLP 역직렬화 로직 수정 (성공)

### 단계 4: 검증
- 첫 컨트랙트 배포(nonce=0) 성공
- `contractAddress` 정상 저장/조회 확인
- Receipt API 정상 응답 확인

## 테스트 결과

### 성공 케이스
```
트랜잭션 해시: 0x03e66d60d84552eb0df89f3e1ec036f4b09965adbb76c69764109bc5ffd8e62a
contractAddress: 0xeab9704bc75ac5b86259af7049a91c81fcd15f4c
타입: str
길이: 42 (0x + 40 hex chars)
유효성: OK
```

### 로그 확인
```
[VM] Contract address extracted: 0xeab9704bc75ac5b86259af7049a91c81fcd15f4c
[BlockLevelDBRepository] Serializing receipt: contractAddress=0xeab9704bc75ac5b86259af7049a91c81fcd15f4c
```

## 참고 사항

### VM 버전
- `@ethereumjs/vm`: 10.x
- `@ethereumjs/tx`: 10.x
- `@ethereumjs/common`: 10.x
- `@ethereumjs/util`: 10.x

### 호환성
- 이더리움 표준과 호환
- 첫 컨트랙트 배포(nonce=0) 정상 처리
- Receipt 형식 이더리움 JSON-RPC 표준 준수

### 향후 개선 사항
- VM 라이브러리 업데이트 시 패치 유지 필요
- 이전에 잘못 저장된 Receipt 데이터 마이그레이션 고려
- 컨트랙트 배포 실패 시 더 상세한 에러 메시지 제공

