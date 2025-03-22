import { describe, expect, it } from '@jest/globals';
import { delayExposeTimeout } from '@util/delay';

describe('delay', () => {
  it('should delay with timeout', () => {
    const delay = delayExposeTimeout(1000);
    expect(delay.timeout).not.toBeNull();
  });
});
