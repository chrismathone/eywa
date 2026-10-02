import 'server-only';
import { canManageTenant } from '@/lib/auth/perm-matrix';

type Role = Parameters<typeof canManageTenant>[0];
/**
 * 시간표 편집기(연습본)를 쓸 수 있는가 — 시간표와 반을 **모두** 관리할 수 있는 역할만.
 * 진입 버튼(시간표 화면) · 편집기 화면 · 연습본 저장/불러오기 · 기존 시간표 읽기가 전부 이 판정 하나를 쓴다
 * (#77: 화면에서만 감추면 주소를 직접 쳐서 들어온다).
 */
export async function canUseTimetableEditor(role: Role): Promise<boolean> {
  const grants = await Promise.all([canManageTenant(role, 'timetable'), canManageTenant(role, 'classes')]);
  return grants.every(Boolean);
}
