import { Attestation } from '../../../src/consensus/entities/attestation.entity';

/**
 * Attestation Entity 테스트
 *
 * 테스트 범위:
 * - Attestation 생성
 * - JSON 변환
 */
describe('Attestation Entity', () => {
  describe('생성자', () => {
    it('Attestation을 생성해야 함', () => {
      const attestation = new Attestation(
        0,
        '0x' + 'b'.repeat(64),
        '0x' + 'v'.repeat(40),
        {
          v: 27,
          r: '0x' + 'r'.repeat(64),
          s: '0x' + 's'.repeat(64),
        },
      );

      expect(attestation.slot).toBe(0);
      expect(attestation.blockHash).toBe('0x' + 'b'.repeat(64));
      expect(attestation.validator).toBe('0x' + 'v'.repeat(40));
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const attestation = new Attestation(
        10,
        '0x' + 'b'.repeat(64),
        '0x' + 'v'.repeat(40),
        {
          v: 27,
          r: '0x' + 'r'.repeat(64),
          s: '0x' + 's'.repeat(64),
        },
      );

      const json = attestation.toJSON();

      expect(json.slot).toBe(10);
      expect(json.blockHash).toBe(attestation.blockHash);
      expect(json.validator).toBe(attestation.validator);
    });
  });
});

