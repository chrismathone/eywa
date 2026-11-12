/**
 * 강사평가 계열(강사평가 · 퇴원관리 담당 · 시간표 X · 원생 기여도)의 **반 담임 이력**(순수 · Vitest).
 *
 * 🔴 왜 따로 두나(원장 2026-11-11 *"수강기간과 담당이 일치하는데로 퇴원을 제대로 잡은거 맞겠지? 모든 곳에서 일치하는 데이터가 출력되어야해"*):
 *    옛 이력은 감사로그 전이(`class_handover_apply`·`class_update`의 newTeacherId)만 읽었는데, 운영 DB에서 담임 교체 132건 중 **62건이
 *    감사로그에 없었다**(일괄 인계 · 영어 시간표 시트 적용 · 8/4 전 반 수정 · 7월 이관 정리). 이력이 빠진 반은 지금 담임을 과거 모든 날짜에
 *    붙였다(9/1 입사 강사에게 4~8월 퇴원율). DB 트리거가 모든 쓰기 경로를 남기는 `activity_log`(classes.teacher_id old→new)를 함께 읽는다.
 * ⚠️ 출석부 강사 축·급여 조립의 이력(`classes/teacher-as-of.ts`)은 이 모듈을 쓰지 않는다 — 금액이 바뀌는 일이라 원장 결정 뒤에 옮긴다
 *    (Claude·Codex 합의 2026-11-11). 그래서 공용 `HomeroomPeriod` 타입도 건드리지 않는다(여기는 '담임 없음' 구간을 가진다).
 */

/** 한 번의 담임 변경 — `teacherId` null = 담임을 비웠다(그 앞 담임의 구간이 끝난다). */
export type HomeroomChange = { classId: string; date: string; teacherId: string | null; previousTeacherId: string | null };
export type EvalHomeroomPeriod = { teacherId: string | null; from: string | null; to: string | null };

/** 감사로그 전이(적용일이 있는 사실) — 반 id를 못 잇는 줄은 호출부가 이미 걸렀다. */
export type AuditChange = HomeroomChange;
/** activity_log 한 줄 — `at` = 처리 시각(ISO) · old/new = 그때 바뀐 값. */
export type ActivityTeacherChange = { classId: string; at: string; oldTeacherId: string | null; newTeacherId: string | null };

const DAY = 86_400_000;
const dayNumber = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / DAY;
/** ISO 시각 → 한국 날짜(YYYY-MM-DD). */
export function kstDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 10) : "";
}
/** 감사로그와 activity_log를 같은 변경으로 짝지을 최대 날짜 차 — 예약 인계는 적용일(감사로그)과 처리일(activity)이 며칠 어긋난다. */
export const PAIR_WINDOW_DAYS = 3;

/**
 * 감사로그 전이 + activity_log 담임 변경 → 한 벌. 같은 반 · 같은 새 담임 · 날짜 차 3일 안이면 **가장 가까운 짝 하나**와 묶어 감사로그 쪽(적용일)을
 * 쓴다(한 감사로그는 한 activity하고만 — A→B→A→B처럼 오간 변경이 서로 먹지 않게). 짝이 없는 activity는 처리일(한국 날짜)로 넣는다.
 * 🔴 짝지은 감사로그에 **이전 담임이 비어 있으면 activity의 옛 값으로 채운다** — 인계 기록이 이전 담임을 안 남긴 반(실데이터: 8/3 '초등M 초4 EL2S'
 *    인계 = 이전 담임 없음 · activity = 허은진→남정화)은 그 앞이 '모름'이 되어 4~7월 담임이 사라졌다(4~7월 보고서는 허은진이 썼다).
 * old=new · 둘 다 빈 줄은 변경이 아니라 버린다.
 * 🔴 **비어 있던 담임 칸을 채운 변경(old=null)은 교체가 아니다** — 반을 만들며 담임을 넣은 줄, 이관 정리에서 끝난 반(7/2 종강)에 7/22 담임을
 *    채운 줄처럼 '원래 그 사람'을 적은 정정이다(실데이터: 2025년 입사 김태건의 끝난 반 LT1·PL5). 교체로 읽으면 채운 날 전이 '모름'이 되어
 *    실제 담당이 사라진다 → 버리고, 그 반의 그 앞은 다음 기록(또는 지금 담임)이 정한다.
 */
export function mergeHomeroomChanges(audit: readonly AuditChange[], activity: readonly ActivityTeacherChange[]): HomeroomChange[] {
  const out: HomeroomChange[] = audit.map((t) => ({ ...t }));
  const dates = activity.map((a) => kstDay(a.at));
  // 짝 후보 = 같은 반 · 같은 새 담임 · 3일 안. **가까운 짝부터**(같은 날 → 하루 차 …, 같으면 먼저 처리된 activity) 하나씩 —
  // 반을 비웠다 같은 사람을 다시 넣은 날(A→B · B→없음 · 없음→B)에 먼 A→B가 그날 인계를 가로채 이력을 잃지 않게(Codex 리뷰 2026-11-11).
  // 빈 칸 채우기(old=null) activity도 짝으로는 쓴다(짝이 없으면 버린다 — 교체가 아니다).
  const pairs: { act: number; aud: number; gap: number }[] = [];
  activity.forEach((a, ai) => {
    if (a.oldTeacherId === a.newTeacherId || !dates[ai]) return;
    audit.forEach((t, ti) => {
      if (t.classId !== a.classId || t.teacherId !== a.newTeacherId) return;
      const gap = Math.abs(dayNumber(t.date) - dayNumber(dates[ai]!));
      if (gap <= PAIR_WINDOW_DAYS) pairs.push({ act: ai, aud: ti, gap });
    });
  });
  pairs.sort((x, y) => x.gap - y.gap || x.act - y.act || x.aud - y.aud);
  const pairedAct = new Map<number, number>();
  const usedAud = new Set<number>();
  for (const p of pairs) {
    if (pairedAct.has(p.act) || usedAud.has(p.aud)) continue;
    pairedAct.set(p.act, p.aud);
    usedAud.add(p.aud);
  }
  activity.forEach((a, ai) => {
    const aud = pairedAct.get(ai);
    if (aud !== undefined) {
      // 감사로그가 이전 담임을 안 남겼으면 DB가 남긴 옛 값으로 채운다.
      if (!out[aud]!.previousTeacherId && a.oldTeacherId) out[aud]!.previousTeacherId = a.oldTeacherId;
      return;
    }
    if (a.oldTeacherId === a.newTeacherId || !a.oldTeacherId || !dates[ai]) return;
    out.push({ classId: a.classId, date: dates[ai]!, teacherId: a.newTeacherId, previousTeacherId: a.oldTeacherId });
  });
  return out;
}

/**
 * 반 → 담임 구간(끝 날짜 미포함). 같은 날 여러 번 바꿨으면 마지막 값이 그날의 담임. 첫 변경의 '이전 담임'은 그 날 전까지로 둔다
 * (기록이 시작되기 전의 담임 — 재직 기간 밖은 `employedOn`이 자른다). '담임 없음'(null) 구간도 그대로 둔다.
 */
export function buildEvalHomeroomHistory(changes: readonly HomeroomChange[]): Map<string, EvalHomeroomPeriod[]> {
  const grouped = new Map<string, HomeroomChange[]>();
  for (const c of changes) {
    if (!c.classId || !c.date) continue;
    (grouped.get(c.classId) ?? grouped.set(c.classId, []).get(c.classId)!).push(c);
  }
  const result = new Map<string, EvalHomeroomPeriod[]>();
  for (const [id, rows] of grouped) {
    // 같은 날 안의 차례는 들어온 차례(감사로그 → activity)를 지킨다 — 안정 정렬.
    const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i).map((x) => x.r);
    const periods: EvalHomeroomPeriod[] = [];
    const first = sorted[0]!;
    const previous = sorted.find((t) => t.date === first.date && t.previousTeacherId)?.previousTeacherId;
    if (previous) periods.push({ teacherId: previous, from: null, to: first.date });
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i]!;
      const to = sorted[i + 1]?.date ?? null;
      if (to === t.date) continue;
      periods.push({ teacherId: t.teacherId, from: t.date, to });
    }
    result.set(id, periods);
  }
  return result;
}

/**
 * 그날 담임. 이력이 없으면 지금 담임(이력이 없는 반 = 담임이 바뀐 적 없는 반 — activity_log를 합친 뒤엔 정말로 그렇다).
 * 이력이 있는데 그날이 첫 기록보다 앞이고 '이전 담임'도 모르면 null(모름 — 지금 담임을 거슬러 붙이지 않는다).
 * 마지막(열린) 구간이 지금 값과 어긋나면 지금 값(기록 밖에서 바뀐 것 — 감사·activity 둘 다 못 남긴 경우).
 */
export function evalHomeroomOnDate(history: readonly EvalHomeroomPeriod[] | undefined, currentTeacherId: string | null, date: string): string | null {
  if (!history?.length) return currentTeacherId;
  const period = history.find((p) => (!p.from || p.from <= date) && (!p.to || date < p.to));
  if (period && !period.to && period.teacherId !== currentTeacherId) return currentTeacherId;
  return period?.teacherId ?? null;
}

/** 재직 기간 — 입사일 · 퇴사일(퇴사 상태일 때만). 모르는 쪽은 자르지 않는다. */
export type Tenure = { hireDate: string | null; resignDate: string | null };
/**
 * 그날 그 강사가 재직 중이었나 — 입사일 전 · 퇴사일 뒤는 아니다(원장 2026-11-11 *"실제 선생님이 입사한 날부터"*). 재직 정보가 없는 사람은 늘 참.
 * ⚠️ 재직은 담당의 **필요조건**일 뿐 증거가 아니다(Codex) — 담당을 만들지 않고, 있는 담당 중 재직 밖만 지운다.
 */
export function buildEmployedOn(tenure: ReadonlyMap<string, Tenure>): (teacherId: string, day: string) => boolean {
  return (teacherId, day) => {
    const t = tenure.get(teacherId);
    if (!t) return true;
    const hire = t.hireDate?.slice(0, 10) ?? null, resign = t.resignDate?.slice(0, 10) ?? null;
    if (hire && day < hire) return false;
    // 입사일보다 앞선 퇴사일은 옛 재직의 것 — 지금 재직을 자르지 않는다(재입사).
    if (resign && !(hire && resign < hire) && day > resign) return false;
    return true;
  };
}
