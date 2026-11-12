import { describe, expect, it, vi } from 'vitest';
import type { Draft } from '../editor/model';
import { assertTimetableLabSeats, newEnrolledStudentCount } from './apply-store';

const draft = {
  placements: [{ id: 'slot', studentIds: ['new:assigned'] }],
  students: { waiting: ['new:also-assigned'] },
} as unknown as Draft;
const plan = {
  students: [
    { id: 'new:assigned', beforeName: null },
    { id: 'new:also-assigned', beforeName: null },
    { id: 'new:prospect', beforeName: null },
    { id: 'old:rename', beforeName: '기존 학생' },
  ],
};

describe('시간표 연습본 재원생 좌석', () => {
  it('실제 반에 배치되어 재원으로 들어갈 새 학생만 센다', () => {
    expect(newEnrolledStudentCount(plan as never, draft)).toBe(2);
  });

  it('실제 반영 시 좌석 초과 사유를 그대로 거절한다', async () => {
    const check = vi.fn(async () => '재원생 좌석이 다 찼습니다 — 최대 10석 중 10명 재원. 좌석을 늘리려면 운영사에 문의하세요');

    await expect(assertTimetableLabSeats('tenant', plan as never, draft, check)).rejects.toThrow('재원생 좌석이 다 찼습니다');
    expect(check).toHaveBeenCalledWith('tenant', 2);
  });

  it('침산처럼 최대 좌석이 없으면 종전대로 통과한다', async () => {
    await expect(assertTimetableLabSeats('cs', plan as never, draft, async () => null)).resolves.toBeUndefined();
  });
});
