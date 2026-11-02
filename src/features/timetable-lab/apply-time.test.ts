import { describe, expect, it } from 'vitest';
import { kstClock, labApplyLabel, nextApplyHour, normalizeApplyTime } from './apply-time';

describe('연습본 적용 · KST 정시', () => {
  it('KST 자정·23시를 서버 타임존과 무관하게 UTC로 바꾼다', () => {
    const before = new Date('2026-10-07T14:30:00Z');
    expect(normalizeApplyTime('2026-10-08', 0, before)).toMatchObject({ at: '2026-10-07T15:00:00.000Z' });
    expect(normalizeApplyTime('2026-10-08', 23, before)).toMatchObject({ at: '2026-10-08T14:00:00.000Z' });
    expect(kstClock(new Date('2026-10-07T15:00:00Z'))).toEqual({ date: '2026-10-08', hour: 0 });
  });
  it('시간 범위·소수·과거 시각·실재하지 않는 날짜를 거절한다', () => {
    const now = new Date('2026-10-08T01:01:00Z');
    for (const hour of [-1, 24, 10.5, NaN]) expect(normalizeApplyTime('2026-10-08', hour, now)).toHaveProperty('error');
    expect(normalizeApplyTime('2026-10-08', 10, now)).toHaveProperty('error');
    expect(normalizeApplyTime('2026-11-31', 0, now)).toHaveProperty('error');
  });
  it('다음 정시는 자정에 날짜까지 넘기고, 정시와 동일한 시각은 서버에서 허용한다', () => {
    const now = new Date('2026-10-08T14:50:00Z');
    expect(nextApplyHour(now)).toEqual({ date: '2026-10-09', hour: 0 });
    expect(normalizeApplyTime('2026-10-08', 23, new Date('2026-10-08T14:00:00Z'))).toMatchObject({ hour: 23 });
  });
});

describe('연습본 예약 배지 문구', () => {
  it('UTC로 저장된 예약 시각을 KST로 읽는다', () => {
    expect(labApplyLabel('2026-11-02T07:00:00+00:00', '2026-11-02')).toBe('11/2 16시 연습본 적용 예정');
    expect(labApplyLabel('2026-11-02T15:00:00+00:00', '2026-11-02')).toBe('11/3 0시 연습본 적용 예정');
  });
});
