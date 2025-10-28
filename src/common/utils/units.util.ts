/**
 * 단위 변환 유틸리티 (Ethereum 표준)
 *
 * Dustin Chain 단위 체계:
 * - 1 DUTN = 1,000,000,000,000,000,000 Wei (10^18)
 * - 1 DUTN = 1,000,000,000 Gwei (10^9)
 * - 1 Gwei = 1,000,000,000 Wei (10^9)
 *
 * 이더리움과 동일:
 * - 1 ETH = 10^18 Wei
 * - 1 ETH = 10^9 Gwei
 * - 1 Gwei = 10^9 Wei
 *
 * 최소 전송 금액: 1 Wei
 */

// 단위 상수
export const WEI_PER_GWEI = 1_000_000_000n; // 10^9
export const WEI_PER_DUTN = 1_000_000_000_000_000_000n; // 10^18
export const GWEI_PER_DUTN = 1_000_000_000n; // 10^9

/**
 * DUTN → Wei 변환
 *
 * @example
 * dutnToWei(1) // 1000000000000000000n (1 DUTN)
 * dutnToWei(0.5) // 500000000000000000n (0.5 DUTN)
 * dutnToWei("1.5") // 1500000000000000000n (1.5 DUTN)
 *
 * @param dutn - DUTN 금액 (number, string, bigint)
 * @returns Wei 단위의 bigint
 */
export function dutnToWei(dutn: number | string | bigint): bigint {
  if (typeof dutn === 'bigint') {
    return dutn * WEI_PER_DUTN;
  }

  // number를 string으로 변환 (과학적 표기법 처리)
  let dutnStr: string;
  if (typeof dutn === 'number') {
    // 과학적 표기법을 일반 표기법으로 변환
    dutnStr = dutn.toLocaleString('en-US', {
      useGrouping: false,
      minimumFractionDigits: 0,
      maximumFractionDigits: 18,
    });
  } else {
    dutnStr = dutn;
  }

  // 소수점 처리
  if (dutnStr.includes('.')) {
    const [integer, decimal] = dutnStr.split('.');

    // 소수점 이하 18자리까지만 허용 (Wei 정밀도)
    const paddedDecimal = decimal.padEnd(18, '0').slice(0, 18);

    return BigInt(integer || '0') * WEI_PER_DUTN + BigInt(paddedDecimal);
  }

  return BigInt(dutnStr) * WEI_PER_DUTN;
}

/**
 * Wei → DUTN 변환
 *
 * @example
 * weiToDutn(1000000000000000000n) // "1.0" (1 DUTN)
 * weiToDutn(500000000000000000n) // "0.5" (0.5 DUTN)
 * weiToDutn(1500000000000000000n) // "1.5" (1.5 DUTN)
 *
 * @param wei - Wei 금액 (bigint)
 * @param decimals - 소수점 자릿수 (기본값: 18)
 * @returns DUTN 단위의 문자열
 */
export function weiToDutn(wei: bigint, decimals: number = 18): string {
  const weiStr = wei.toString().padStart(19, '0'); // 최소 19자리 (0. + 18자리)

  const integerPart = weiStr.slice(0, -18) || '0';
  const decimalPart = weiStr.slice(-18);

  // decimals만큼만 표시 (뒤의 0 제거)
  const trimmedDecimal = decimalPart.slice(0, decimals).replace(/0+$/, '');

  if (trimmedDecimal === '') {
    return integerPart;
  }

  return `${integerPart}.${trimmedDecimal}`;
}

/**
 * Gwei → Wei 변환
 *
 * @example
 * gweiToWei(1) // 1000000000n (1 Gwei)
 * gweiToWei(21) // 21000000000n (21 Gwei, 기본 Gas Price)
 *
 * @param gwei - Gwei 금액 (number, string, bigint)
 * @returns Wei 단위의 bigint
 */
export function gweiToWei(gwei: number | string | bigint): bigint {
  if (typeof gwei === 'bigint') {
    return gwei * WEI_PER_GWEI;
  }

  // number를 string으로 변환 (과학적 표기법 처리)
  let gweiStr: string;
  if (typeof gwei === 'number') {
    gweiStr = gwei.toLocaleString('en-US', {
      useGrouping: false,
      minimumFractionDigits: 0,
      maximumFractionDigits: 9,
    });
  } else {
    gweiStr = gwei;
  }

  // 소수점 처리
  if (gweiStr.includes('.')) {
    const [integer, decimal] = gweiStr.split('.');

    // 소수점 이하 9자리까지만 허용 (Gwei 정밀도)
    const paddedDecimal = decimal.padEnd(9, '0').slice(0, 9);

    return BigInt(integer || '0') * WEI_PER_GWEI + BigInt(paddedDecimal);
  }

  return BigInt(gweiStr) * WEI_PER_GWEI;
}

/**
 * Wei → Gwei 변환
 *
 * @example
 * weiToGwei(1000000000n) // "1.0" (1 Gwei)
 * weiToGwei(21000000000n) // "21.0" (21 Gwei)
 *
 * @param wei - Wei 금액 (bigint)
 * @param decimals - 소수점 자릿수 (기본값: 9)
 * @returns Gwei 단위의 문자열
 */
export function weiToGwei(wei: bigint, decimals: number = 9): string {
  const weiStr = wei.toString().padStart(10, '0'); // 최소 10자리 (0. + 9자리)

  const integerPart = weiStr.slice(0, -9) || '0';
  const decimalPart = weiStr.slice(-9);

  // decimals만큼만 표시 (뒤의 0 제거)
  const trimmedDecimal = decimalPart.slice(0, decimals).replace(/0+$/, '');

  if (trimmedDecimal === '') {
    return integerPart;
  }

  return `${integerPart}.${trimmedDecimal}`;
}

/**
 * DUTN → Gwei 변환
 *
 * @example
 * dutnToGwei(1) // 1000000000n (1 DUTN = 1,000,000,000 Gwei)
 * dutnToGwei(0.000000001) // 1n (1 Gwei)
 *
 * @param dutn - DUTN 금액 (number, string, bigint)
 * @returns Gwei 단위의 bigint
 */
export function dutnToGwei(dutn: number | string | bigint): bigint {
  const wei = dutnToWei(dutn);
  return wei / WEI_PER_GWEI;
}

/**
 * Gwei → DUTN 변환
 *
 * @example
 * gweiToDutn(1000000000n) // "1.0" (1,000,000,000 Gwei = 1 DUTN)
 * gweiToDutn(1n) // "0.000000001" (1 Gwei)
 *
 * @param gwei - Gwei 금액 (bigint)
 * @param decimals - 소수점 자릿수 (기본값: 18)
 * @returns DUTN 단위의 문자열
 */
export function gweiToDutn(gwei: bigint, decimals: number = 18): string {
  const wei = gwei * WEI_PER_GWEI;
  return weiToDutn(wei, decimals);
}

/**
 * 금액 포맷팅 (읽기 쉽게)
 *
 * @example
 * formatDutn(1500000000000000000n) // "1.5 DUTN"
 * formatDutn(1500000000000000000n, 'wei') // "1500000000000000000 Wei"
 * formatDutn(1500000000000000000n, 'gwei') // "1500000000.0 Gwei"
 *
 * @param amount - 금액 (Wei 단위 bigint)
 * @param unit - 표시 단위 ('dutn' | 'gwei' | 'wei')
 * @param decimals - 소수점 자릿수
 * @returns 포맷된 문자열
 */
export function formatDutn(
  amount: bigint,
  unit: 'dutn' | 'gwei' | 'wei' = 'dutn',
  decimals?: number,
): string {
  switch (unit) {
    case 'dutn':
      return `${weiToDutn(amount, decimals ?? 4)} DUTN`;
    case 'gwei':
      return `${weiToGwei(amount, decimals ?? 2)} Gwei`;
    case 'wei':
      return `${amount.toString()} Wei`;
    default:
      return `${weiToDutn(amount, decimals ?? 4)} DUTN`;
  }
}

/**
 * 금액 파싱 (문자열 → Wei)
 *
 * @example
 * parseDutn("1.5 DUTN") // 1500000000000000000n
 * parseDutn("21 Gwei") // 21000000000n
 * parseDutn("1000 Wei") // 1000n
 * parseDutn("1.5") // 1500000000000000000n (기본값: DUTN)
 *
 * @param input - 금액 문자열
 * @returns Wei 단위의 bigint
 */
export function parseDutn(input: string): bigint {
  const normalized = input.trim().toLowerCase();

  if (normalized.endsWith('dutn')) {
    const amount = normalized.replace('dutn', '').trim();
    return dutnToWei(amount);
  }

  if (normalized.endsWith('gwei')) {
    const amount = normalized.replace('gwei', '').trim();
    return gweiToWei(amount);
  }

  if (normalized.endsWith('wei')) {
    const amount = normalized.replace('wei', '').trim();
    return BigInt(amount);
  }

  // 단위 없으면 DUTN으로 가정
  return dutnToWei(normalized);
}
