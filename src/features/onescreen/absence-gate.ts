/**
 * 결석 발송 게이트 — 순수 판정(#77 공용 게이트화, 2026-07-19).
 * 원스크린 클라 게이트(grid.ts isRowActionable: send/autowrite=결석 제외)는 화면 한 겹이라
 * 서버 액션 직접 호출·stale 화면·관리자 발송 경로(발송 콘솔·반 단위 대량·재발송)에서 우회된다
 * → 발송·큐잉 **서버** 경로 전부가 이 판정을 공유한다(감지 이벤트 detectUnsentReports 포함 — 게이트 동일 불변식).
 *
 * 규약(클라 게이트와 동일 축 + 사각 보수):
 * - 유효 레코드 = 반(class) 단위 recorded_at 최신 1건, 동률이면 id 내림차순(effective-records·DB RPC와 동일 tie-break).
 * - 차단 = 그날 그 과목 반들의 유효 출결이 **전부 결석 계열(absent·excused)**일 때만.
 *   excused는 폐지된 결석 별칭(2026-07-09 통일)이라 방어 포함 — 클라는 absent만 보지만 서버는 레거시 행도 막는다.
 * - 통과(fail-open) = 기록 없음(기록 없음≠결석 — roster 초기값 "출석"과 정합) · 한 반이라도 출석 계열
 *   (present/late/early_leave/makeup — 조퇴·지각은 수업을 들었으므로 발송 유지, grid.ts 규약).
 *   같은 과목 두 반 수강(클라 attendanceRaw 미채움 사각)도 이 규칙으로 자연 판정된다.
 */

export type AbsenceGateRecord = {
  classId: string;
  status: string;
  recordedAt: string; // ISO timestamptz
  id: string;
};

/** 발송 차단 status — absent + excused(폐지된 결석 별칭, 레거시 행 방어). */
const BLOCKING = new Set(["absent", "excused"]);

/** 파싱 불가 recordedAt = throw — effective-records와 동일 계약(호출부 catch가 fail-closed로 발송 중단).
 *  NaN을 침묵 수용하면 비교가 전부 false라 "먼저 본 레코드 승리" = 입력 순서 의존 오판이 된다(적대 리뷰). */
function recordedAtMs(value: string): number {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) throw new RangeError(`Invalid attendance recorded_at: ${value}`);
  return ts;
}

/** 그날 그 과목 출결 레코드(반 불문 전체) → 발송 차단 여부. 빈 배열 = 통과(fail-open). */
export function isAbsentForSend(records: readonly AbsenceGateRecord[]): boolean {
  if (records.length === 0) return false;
  const latestByClass = new Map<string, AbsenceGateRecord>();
  for (const rec of records) {
    const prev = latestByClass.get(rec.classId);
    if (!prev) {
      latestByClass.set(rec.classId, rec);
      continue;
    }
    const a = recordedAtMs(rec.recordedAt);
    const b = recordedAtMs(prev.recordedAt);
    if (a > b || (a === b && rec.id > prev.id)) latestByClass.set(rec.classId, rec);
  }
  for (const rec of latestByClass.values()) {
    if (!BLOCKING.has(rec.status)) return false; // 출석 계열 반이 하나라도 있으면 통과
  }
  return true;
}
