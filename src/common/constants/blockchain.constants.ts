/**
 * 블록체인 전역 상수 정의
 * 이더리움 POS 기반 파라미터
 */

/**
 * BLOCK_TIME: 블록 생성 주기 (초)
 *
 * 이더리움에서:
 * - 12초 (1 slot)
 * - 일정한 간격으로 블록 생성
 *
 * 왜 이 값인가:
 * - 너무 짧으면: 네트워크 부하, 포크 발생 가능성 증가
 * - 너무 길면: 트랜잭션 확인 시간 지연
 */
export const BLOCK_TIME = 12; // seconds

/**
 * EPOCH_SIZE: 한 에포크당 슬롯(블록) 수
 *
 * 이더리움에서:
 * - 1 epoch = 32 slots = 6.4분
 * - 각 에포크마다 밸리데이터 셔플링
 *
 * 왜 필요한가:
 * - 밸리데이터 선택 주기 관리
 * - 체크포인트 생성 주기
 */
export const EPOCH_SIZE = 32; // blocks

/**
 * MIN_STAKE: 밸리데이터가 되기 위한 최소 스테이킹 금액 (DSTN)
 *
 * 이더리움에서:
 * - 32 ETH
 * - 밸리데이터 참여 장벽
 *
 * 왜 필요한가:
 * - 악의적 행동의 비용 증가
 * - 네트워크 보안 강화
 * - 밸리데이터 수 조절
 */
export const MIN_STAKE = 32; // DSTN

/**
 * BLOCK_REWARD: 블록 생성 보상 (DSTN)
 *
 * 이더리움에서:
 * - 약 0.02-0.03 ETH (변동)
 * - 스테이킹 보상으로 지급
 *
 * 왜 필요한가:
 * - 밸리데이터 참여 인센티브
 * - 네트워크 보안 유지
 *
 * Dustin-Chain:
 * - 단순화를 위해 고정값 2 DSTN
 */
export const BLOCK_REWARD = 2; // DSTN

/**
 * GENESIS_BALANCE: Genesis 블록 초기 분배 금액
 *
 * 이더리움에서:
 * - ICO로 약 7200만 ETH 분배
 *
 * Dustin-Chain:
 * - 창시자 계정: 10,000,000 DSTN
 * - 테스트 계정들: 각 100,000 DSTN
 */
export const GENESIS_BALANCE = {
  FOUNDER: 10_000_000, // 창시자
  TEST_ACCOUNT: 100_000, // 테스트 계정
};

/**
 * CHAIN_ID: 체인 식별자
 *
 * 이더리움에서:
 * - 메인넷: 1
 * - Goerli: 5
 * - Sepolia: 11155111
 *
 * 왜 필요한가:
 * - 리플레이 공격 방지 (EIP-155)
 * - 다른 체인과 구분
 *
 * Dustin-Chain: 999 (임의 지정)
 */
export const CHAIN_ID = 999;

/**
 * WEI_PER_DSTN: 1 DSTN당 Wei 수
 *
 * 이더리움에서:
 * - 1 ETH = 10^18 Wei
 *
 * 왜 필요한가:
 * - 소수점 연산 없이 정수로만 계산
 * - 정밀도 유지
 */
export const WEI_PER_DSTN = BigInt(10 ** 18);

/**
 * GAS_LIMIT: 블록당 최대 가스 한도
 *
 * 이더리움에서:
 * - 약 30,000,000 gas
 * - 블록당 처리 가능한 트랜잭션 수 제한
 *
 * Dustin-Chain:
 * - 단순화를 위해 트랜잭션 개수로만 제한 (나중에 구현)
 */
export const MAX_TRANSACTIONS_PER_BLOCK = 1000;

/**
 * WITHDRAWAL_DELAY: 스테이킹 인출 대기 시간 (블록 수)
 *
 * 이더리움에서:
 * - 약 27시간 (최소)
 * - 검증자 이탈 시 패널티 기간
 *
 * 왜 필요한가:
 * - 악의적 행동 후 즉시 탈출 방지
 * - 슬래싱 집행 시간 확보
 *
 * Dustin-Chain: 256 블록 (약 51분)
 */
export const WITHDRAWAL_DELAY = 256; // blocks
