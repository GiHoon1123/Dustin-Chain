import { Injectable } from '@nestjs/common';
import * as elliptic from 'elliptic';
import * as keccak from 'keccak';
import { RLP } from '@ethereumjs/rlp';
import { bytesToHex, hexToBytes } from '@ethereumjs/util';
import { CHAIN_ID } from '../constants/blockchain.constants';
import {
  addHexPrefix,
  Address,
  Hash,
  isValidHash,
  isValidPrivateKey,
  PrivateKey,
  PublicKey,
  stripHexPrefix,
} from '../types/common.types';
import { KeyPair, Signature } from './crypto.types';

/**
 * CryptoService
 *
 * 블록체인의 모든 암호화 기능을 담당하는 핵심 서비스
 * 이더리움과 동일한 암호화 알고리즘 사용:
 * - secp256k1 타원곡선 (ECDSA)
 * - Keccak-256 해싱
 *
 * 왜 필요한가:
 * - 지갑 생성 및 관리
 * - 트랜잭션 서명 및 검증
 * - 블록 해시 계산
 * - 데이터 무결성 검증
 */
@Injectable()
export class CryptoService {
  /**
   * secp256k1 타원곡선 인스턴스
   *
   * 이더리움에서의 동작:
   * - 비트코인과 동일한 곡선 사용
   * - ECDSA 서명/검증에 사용
   * - 개인키로부터 공개키 생성
   */
  private readonly ec: elliptic.ec;

  constructor() {
    this.ec = new elliptic.ec('secp256k1');
  }

  /**
   * Keccak-256 해시 (Buffer 입력)
   *
   * 이더리움에서의 동작:
   * - 모든 해싱에 사용
   * - 32바이트 (256비트) 출력
   *
   * @param buffer - 해싱할 데이터 (Buffer)
   * @returns "0x" + 64 hex characters (32 bytes)
   */
  hashBuffer(buffer: Buffer): Hash {
    const hash = keccak('keccak256').update(buffer).digest('hex');
    return addHexPrefix(hash);
  }

  /**
   * Keccak-256 해시 (HEX 문자열 입력)
   *
   * 사용처:
   * - 트랜잭션 해시
   * - 블록 해시
   * - 이미 hex로 인코딩된 데이터 해싱
   *
   * @param hex - HEX 문자열 ("0x" 접두사 선택)
   * @returns "0x" + 64 hex characters
   */
  hashHex(hex: string): Hash {
    const stripped = stripHexPrefix(hex);
    const buffer = Buffer.from(stripped, 'hex');
    return this.hashBuffer(buffer);
  }

  /**
   * Keccak-256 해시 (UTF-8 텍스트 입력)
   *
   * 사용처:
   * - 메시지 서명 ("hello world" 같은 텍스트)
   * - 사람이 읽을 수 있는 문자열 해싱
   *
   * @param text - UTF-8 텍스트
   * @returns "0x" + 64 hex characters
   */
  hashUtf8(text: string): Hash {
    const buffer = Buffer.from(text, 'utf8');
    return this.hashBuffer(buffer);
  }

  /**
   * 무작위 개인키 생성
   *
   * 이더리움에서의 동작:
   * - 256비트 무작위 숫자
   * - 1 ≤ key < secp256k1.order
   * - 안전한 난수 생성기 사용
   *
   * 개선사항:
   * - ec.genKeyPair() 사용하여 자동으로 유효한 범위 보장
   * - 0이거나 order 이상인 값 자동 제외
   *
   * @returns 64 hex characters로 표현된 개인키
   */
  generatePrivateKey(): PrivateKey {
    // elliptic 라이브러리가 자동으로 유효한 범위의 키 생성
    const keyPair = this.ec.genKeyPair();
    const privateKey = keyPair.getPrivate('hex');
    // 64 hex chars로 패딩 (32 bytes)
    const paddedKey = privateKey.padStart(64, '0');
    return addHexPrefix(paddedKey);
  }

  /**
   * 개인키로부터 공개키 생성
   *
   * 이더리움에서의 동작:
   * - secp256k1 타원곡선의 점 곱셈
   * - 개인키 * G (생성점) = 공개키 (곡선 위의 점)
   * - 비압축 형식: x(32bytes) + y(32bytes) = 64bytes
   *
   * @param privateKey - "0x" 접두사 포함 개인키
   * @returns 128 hex characters (64 bytes)
   */
  getPublicKeyFromPrivate(privateKey: PrivateKey): PublicKey {
    if (!isValidPrivateKey(privateKey)) {
      throw new Error('Invalid private key');
    }

    const stripped = stripHexPrefix(privateKey);
    const keyPair = this.ec.keyFromPrivate(stripped, 'hex');

    // 비압축 공개키 (0x04 접두사 제외)
    const publicKey = keyPair.getPublic().encode('hex', false).slice(2);

    return publicKey;
  }

  /**
   * 공개키로부터 주소 생성
   *
   * 이더리움에서의 동작:
   * 1. 공개키(64바이트) → Keccak-256 해시
   * 2. 해시(32바이트)의 마지막 20바이트만 추출
   * 3. "0x" 접두사 추가
   *
   * @param publicKey - 128 hex characters
   * @returns "0x" + 40 hex characters (20 bytes)
   */
  publicKeyToAddress(publicKey: PublicKey): Address {
    const hash = this.hashHex(publicKey);
    // 마지막 20바이트 (40 hex chars)
    const address = '0x' + stripHexPrefix(hash).slice(-40);
    return address.toLowerCase();
  }

  /**
   * 개인키로부터 주소 직접 생성
   *
   * @param privateKey - 개인키
   * @returns 주소
   */
  privateKeyToAddress(privateKey: PrivateKey): Address {
    const publicKey = this.getPublicKeyFromPrivate(privateKey);
    return this.publicKeyToAddress(publicKey);
  }

  /**
   * 완전한 키 쌍 생성
   *
   * @returns KeyPair 객체 (privateKey, publicKey, address)
   */
  generateKeyPair(): KeyPair {
    const privateKey = this.generatePrivateKey();
    const publicKey = this.getPublicKeyFromPrivate(privateKey);
    const address = this.publicKeyToAddress(publicKey);

    return {
      privateKey,
      publicKey,
      address,
    };
  }

  /**
   * 메시지 서명 (레거시, v = 27/28)
   *
   * 이더리움에서의 동작:
   * - 개인 메시지 서명용
   * - v = recoveryId + 27
   * - 체인 ID 포함 안함
   *
   * @param messageHash - 서명할 메시지 해시 (32 bytes)
   * @param privateKey - 서명에 사용할 개인키
   * @returns Signature (v, r, s)
   */
  sign(messageHash: Hash, privateKey: PrivateKey): Signature {
    if (!isValidHash(messageHash)) {
      throw new Error('Invalid message hash (must be 32 bytes)');
    }

    if (!isValidPrivateKey(privateKey)) {
      throw new Error('Invalid private key');
    }

    const msgHash = stripHexPrefix(messageHash);
    const privKey = stripHexPrefix(privateKey);

    const keyPair = this.ec.keyFromPrivate(privKey, 'hex');
    const signature = keyPair.sign(msgHash, { canonical: true });

    // v = recoveryId + 27 (레거시)
    const v = (signature.recoveryParam ?? 0) + 27;

    // r, s를 32바이트 = 64 hex chars로 패딩
    const r = addHexPrefix(signature.r.toString('hex').padStart(64, '0'));
    const s = addHexPrefix(signature.s.toString('hex').padStart(64, '0'));

    return { v, r, s };
  }

  /**
   * 트랜잭션 서명 (EIP-155, v = chainId * 2 + 35 + recoveryId)
   *
   * 이더리움에서의 동작:
   * - 트랜잭션 서명 전용
   * - 체인 ID를 v 값에 인코딩
   * - 리플레이 공격 방지
   *
   * EIP-155 공식:
   * - v = chainId * 2 + 35 + recoveryId
   * - chainId = (v - 35) / 2
   *
   * @param transactionHash - 트랜잭션 해시
   * @param privateKey - 개인키
   * @param chainId - 체인 ID (기본값: CHAIN_ID 상수)
   * @returns Signature (EIP-155)
   */
  signTransaction(
    transactionHash: Hash,
    privateKey: PrivateKey,
    chainId: number = CHAIN_ID,
  ): Signature {
    if (!isValidHash(transactionHash)) {
      throw new Error('Invalid transaction hash');
    }

    if (!isValidPrivateKey(privateKey)) {
      throw new Error('Invalid private key');
    }

    const msgHash = stripHexPrefix(transactionHash);
    const privKey = stripHexPrefix(privateKey);

    const keyPair = this.ec.keyFromPrivate(privKey, 'hex');
    const signature = keyPair.sign(msgHash, { canonical: true });

    // EIP-155: v = chainId * 2 + 35 + recoveryId
    const recoveryId = signature.recoveryParam ?? 0;
    const v = chainId * 2 + 35 + recoveryId;

    const r = addHexPrefix(signature.r.toString('hex').padStart(64, '0'));
    const s = addHexPrefix(signature.s.toString('hex').padStart(64, '0'));

    return { v, r, s };
  }

  /**
   * 서명으로부터 공개키 복구
   *
   * 이더리움에서의 동작:
   * - 서명(r, s, v)와 메시지 해시로부터 공개키 복구
   * - v 값으로 올바른 공개키 선택
   *
   * v 값 파싱:
   * - v >= 35: EIP-155 (chainId 포함)
   * - v = 27 or 28: 레거시
   *
   * @param messageHash - 원본 메시지 해시
   * @param signature - 서명 (v, r, s)
   * @returns 복구된 공개키
   */
  recoverPublicKey(messageHash: Hash, signature: Signature): PublicKey {
    if (!isValidHash(messageHash)) {
      throw new Error('Invalid message hash');
    }

    const msgHash = stripHexPrefix(messageHash);
    const r = stripHexPrefix(signature.r);
    const s = stripHexPrefix(signature.s);

    // v 값에서 recoveryId 추출
    let recoveryId: number;

    if (signature.v >= 35) {
      // EIP-155
      const chainId = Math.floor((signature.v - 35) / 2);
      recoveryId = signature.v - 35 - chainId * 2;
    } else {
      // 레거시 (27 or 28)
      recoveryId = signature.v - 27;
    }

    // recoveryId는 0 또는 1만 유효
    if (recoveryId !== 0 && recoveryId !== 1) {
      throw new Error(`Invalid recovery id: ${recoveryId}`);
    }

    // 공개키 복구
    const publicKey = this.ec.recoverPubKey(
      Buffer.from(msgHash, 'hex'),
      { r, s },
      recoveryId,
    );

    // 비압축 형식 (0x04 접두사 제외)
    return publicKey.encode('hex', false).slice(2);
  }

  /**
   * 서명으로부터 주소 복구
   *
   * @param messageHash - 원본 메시지 해시
   * @param signature - 서명
   * @returns 서명자의 주소
   */
  recoverAddress(messageHash: Hash, signature: Signature): Address {
    const publicKey = this.recoverPublicKey(messageHash, signature);
    return this.publicKeyToAddress(publicKey);
  }

  /**
   * 서명 검증
   *
   * 이더리움에서의 동작:
   * 1. 서명으로부터 주소 복구
   * 2. 복구된 주소와 예상 주소 비교
   *
   * @param messageHash - 원본 메시지 해시
   * @param signature - 서명
   * @param expectedAddress - 예상되는 서명자 주소
   * @returns 서명이 유효하면 true
   */
  verify(
    messageHash: Hash,
    signature: Signature,
    expectedAddress: Address,
  ): boolean {
    try {
      const recoveredAddress = this.recoverAddress(messageHash, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      return false;
    }
  }

  // ========================================
  // RLP (Recursive Length Prefix) 인코딩
  // ========================================

  /**
   * RLP 인코딩
   *
   * 이더리움에서의 동작:
   * - 데이터를 결정론적으로 바이트 배열로 직렬화
   * - 같은 데이터 → 항상 같은 인코딩 → 같은 해시
   * - JSON보다 크기 작음 (바이너리)
   *
   * 사용처:
   * - 블록 해시 계산
   * - 트랜잭션 해시 계산
   * - 계정 상태 해시 계산
   * - Merkle Trie에 데이터 저장
   *
   * RLP 규칙:
   * - 문자열/바이트 배열: 길이 + 데이터
   * - 리스트: 길이 + 재귀적으로 인코딩된 항목들
   *
   * 예시:
   * ```typescript
   * rlpEncode([5, 1000, "0xabc"]);
   * // → Buffer (바이너리 데이터)
   * ```
   *
   * @param input - 인코딩할 데이터 (숫자, 문자열, 배열, Buffer 등)
   * @returns RLP 인코딩된 Buffer
   */
  rlpEncode(input: any): Uint8Array {
    return RLP.encode(input);
  }

  /**
   * RLP 디코딩
   *
   * 이더리움에서의 동작:
   * - RLP 인코딩된 바이트 배열을 원본 데이터로 복원
   *
   * 사용처:
   * - 네트워크에서 받은 데이터 파싱
   * - Merkle Trie에서 데이터 조회
   * - 블록/트랜잭션 데이터 복원
   *
   * @param encoded - RLP 인코딩된 Buffer 또는 Uint8Array
   * @returns 디코딩된 원본 데이터
   */
  rlpDecode(encoded: Uint8Array): any {
    return RLP.decode(encoded);
  }

  /**
   * RLP 인코딩 + Keccak-256 해시 (Buffer 반환)
   *
   * 이더리움에서의 동작:
   * - 데이터를 RLP 인코딩 → Keccak-256 해시
   * - 가장 흔한 패턴 (블록, 트랜잭션, 계정 등)
   *
   * 사용처:
   * - 블록 해시 계산
   * - 트랜잭션 해시 계산
   * - Merkle Trie 키 생성
   *
   * 예시:
   * ```typescript
   * // 계정 해시
   * const accountHash = rlpHashBuffer([nonce, balance, storageRoot, codeHash]);
   *
   * // 트랜잭션 해시
   * const txHash = rlpHashBuffer([nonce, to, value, data]);
   * ```
   *
   * @param input - 해시할 데이터
   * @returns Keccak-256 해시 (32 bytes Buffer)
   */
  rlpHashBuffer(input: any): Buffer {
    const encoded = this.rlpEncode(input);
    const hash = keccak('keccak256').update(Buffer.from(encoded)).digest();
    return hash;
  }

  /**
   * RLP 인코딩 + Keccak-256 해시 (Hex 문자열 반환)
   *
   * 이더리움에서의 동작:
   * - rlpHashBuffer와 동일하지만 Hex 문자열로 반환
   * - "0x" 접두사 포함
   *
   * 사용처:
   * - API 응답용
   * - 사람이 읽기 쉬운 해시
   *
   * @param input - 해시할 데이터
   * @returns "0x" + 64 hex characters (32 bytes)
   */
  rlpHash(input: any): Hash {
    const hash = this.rlpHashBuffer(input);
    return addHexPrefix(hash.toString('hex'));
  }

  /**
   * Hex 문자열을 Uint8Array로 변환
   *
   * 이더리움 유틸리티:
   * - "0x123abc" → Uint8Array [0x12, 0x3a, 0xbc]
   *
   * 사용처:
   * - RLP 인코딩 전 데이터 변환
   * - Merkle Trie에 데이터 저장
   *
   * @param hex - Hex 문자열 ("0x" 선택)
   * @returns Uint8Array
   */
  hexToBytes(hex: string): Uint8Array {
    const prefixed = hex.startsWith('0x') ? hex : `0x${hex}`;
    return hexToBytes(prefixed as `0x${string}`);
  }

  /**
   * Uint8Array를 Hex 문자열로 변환
   *
   * 이더리움 유틸리티:
   * - Uint8Array [0x12, 0x3a, 0xbc] → "0x123abc"
   *
   * 사용처:
   * - Buffer를 사람이 읽을 수 있는 형태로 변환
   *
   * @param bytes - Uint8Array 또는 Buffer
   * @returns "0x" + hex 문자열
   */
  bytesToHex(bytes: Uint8Array): string {
    return addHexPrefix(bytesToHex(bytes));
  }
}
