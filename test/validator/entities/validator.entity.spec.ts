import { Validator } from '../../../src/validator/entities/validator.entity';

/**
 * Validator Entity 테스트
 *
 * 테스트 범위:
 * - Validator 생성
 * - 활성화/비활성화
 * - JSON 변환
 */
describe('Validator Entity', () => {
  describe('생성자', () => {
    it('Validator를 생성해야 함', () => {
      const address = '0x' + '1'.repeat(40);
      const validator = new Validator(address);

      expect(validator.address).toBe(address);
      expect(validator.isActive).toBe(true);
    });
  });

  describe('활성화/비활성화', () => {
    it('Validator를 비활성화해야 함', () => {
      const validator = new Validator('0x' + '1'.repeat(40));
      validator.deactivate();

      expect(validator.isActive).toBe(false);
    });

    it('Validator를 활성화해야 함', () => {
      const validator = new Validator('0x' + '1'.repeat(40));
      validator.deactivate();
      validator.activate();

      expect(validator.isActive).toBe(true);
    });
  });

  describe('JSON 변환', () => {
    it('JSON으로 변환해야 함', () => {
      const validator = new Validator('0x' + '1'.repeat(40));
      const json = validator.toJSON();

      expect(json.address).toBe(validator.address);
      expect(json.isActive).toBe(true);
    });
  });
});

