import { normalizeEffectiveDate } from '@/features/timetable/import/effective-date';

export function kstClock(now = new Date()) {
  const local = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return { date: local.slice(0, 10), hour: Number(local.slice(11, 13)) };
}

/** 서버·화면 공용. KST 정시를 UTC로 변환하고 이미 지난 시각이나 날짜 오타를 거절한다. */
export function normalizeApplyTime(date: string, hour: number, now = new Date()): { at: string; date: string; hour: number } | { error: string } {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: '적용 시각은 KST 00시~23시 중 정시로 선택해 주세요.' };
  const effective = normalizeEffectiveDate(date, kstClock(now).date);
  if ('error' in effective) return effective;
  const at = new Date(`${effective.date}T${String(hour).padStart(2, '0')}:00:00+09:00`);
  if (at.getTime() < now.getTime()) return { error: '이미 지난 적용 시각입니다. 다음 정시 이후로 선택해 주세요.' };
  return { at: at.toISOString(), date: effective.date, hour };
}

export function nextApplyHour(now = new Date()) {
  const next = new Date(Math.ceil((now.getTime() + 1) / 3600000) * 3600000);
  return kstClock(next);
}
