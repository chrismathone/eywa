import { describe, expect, it } from 'vitest';
import { boundedJson, draftSnapshotSchema, saveDraftSchema } from './draft-schema';
const fixture = () => ({ cells: [Array.from({ length: 6 }, () => ({ text: '' })),
  ['영어 A', '월', '18:00', '19:00', '강사 가', '201'].map(text => ({ text }))],
  placements: [{ id: 'p1', sourceScheduleId: 's1', classId: 'c1', row: 1 }], students: { c1: ['student1'] } });
describe('persisted timetable draft validation', () => {
  it('round-trips class names, ranges, appearance metadata and revision without stripping them', () => {
    const snapshot = { ...fixture(), classes: { c1: { name: '새 영어반', color: { bg: '#123456', text: '#ffffff' } } },
      operatingHours: { 월: [{ start: 540, end: 1320 }] }, classRevision: 2, originId: 'origin-1' };
    expect(saveDraftSchema.parse({ version: 1, name: '  11월 첫 안  ', snapshot })).toEqual({ version: 1, name: '11월 첫 안', snapshot });
  });
  it.each(['wrong-row', 'duplicate-id', 'duplicate-row', 'no-class'])('rejects %s so loading cannot create an ambiguous editor state', fault => {
    const draft = fixture();
    if (fault === 'wrong-row') draft.placements[0].row = 2;
    if (fault === 'duplicate-id') draft.placements.push({ ...draft.placements[0], row: 2 });
    if (fault === 'duplicate-row') draft.placements.push({ ...draft.placements[0], id: 'p2' });
    if (fault === 'no-class') draft.placements[0].classId = '';
    expect(draftSnapshotSchema.safeParse(draft).success).toBe(false);
  });
  it('keeps incomplete cell values editable but refuses unknown versions, fields and malformed arrays', () => {
    expect(draftSnapshotSchema.safeParse(fixture()).success).toBe(true);
    expect(saveDraftSchema.safeParse({ version: 2, name: '안', snapshot: fixture() }).success).toBe(false);
    expect(draftSnapshotSchema.safeParse({ ...fixture(), surprise: 'field' }).success).toBe(false);
    expect(draftSnapshotSchema.safeParse({ ...fixture(), students: { c1: 'student1' } }).success).toBe(false);
  });
  it('rejects prototype keys and excessive recursion before parsing opaque formatting', () => {
    expect(boundedJson(JSON.parse('{"format":{"__proto__":{}}}'))).toBe(false);
    let deep: unknown = {}; for (let i = 0; i < 35; i++) deep = { next: deep };
    expect(boundedJson(deep)).toBe(false); expect(boundedJson(fixture())).toBe(true);
  });
});
