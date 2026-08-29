/**
 * 결석 위험 "N회"를 **과목별로 쪼개는** 순수 함수 (원장 2026-08-29: "운영실 보고시에 과목별 표기되도록 과목 라벨").
 *
 * 🔴 세는 규칙은 `dashboard_absence_risk_admin`(0221a)와 **한 글자도 다르면 안 된다** — 브리핑 카드가
 *    "최근 14일 결석 8회" 옆에 "수학 6 · 영어 2"를 나란히 놓기 때문이다. 분해 합이 총계와 다르면
 *    둘 중 하나는 거짓이고 원장은 어느 쪽이 거짓인지 알 방법이 없다. 그래서 RPC와 같은 두 단계를 그대로 옮긴다:
 *      ① **유효 행**: (학생, 반, 수업일, 교시)별 최신 1건(recorded_at desc, id desc) — 정정된 옛 행을 살리지 않는다.
 *      ② **세는 단위**: 유효 행 중 결석인 것의 `distinct (반, 수업일)` — 교시 수가 아니다(영어는 하루가 2~3행이라
 *         그냥 세면 2.19배가 된다, 0221a).
 *    ⚠️ RPC를 고치면 이 파일도 함께 고칠 것(가드: absence-subjects.test.ts가 0221a 규칙을 예시로 잠근다).
 *
 * 과목 **라벨**은 여기서 붙이지 않는다 — 라벨은 학원설정이 단일 소스라(운영 enum 하드코딩 금지) 호출부가
 * `labelSubjectCounts(…, subjectLabel)`로 입힌다. 이 파일은 raw 과목 키까지만 만든다.
 */

/** 출결 원시 행 — RPC가 보는 컬럼만(select와 같은 snake_case). */
export type AbsenceSubjectRow = {
  student_id: string;
  class_id: string;
  session_date: string;
  slot_start: string | null;
  status: string;
  recorded_at: string | null;
  id: string;
  /** 그 반의 과목 키(학원설정 키). 미설정 반은 null — 버리지 않고 "과목 미상"으로 접힌다. */
  subject: string | null;
};

/** 학생별 과목 분해(건수 desc, 동수는 키순). 합 = 그 학생의 결석 N회. */
export type AbsenceSubjectCounts = Map<string, { subject: string; count: number }[]>;

/** 같은 (학생,반,수업일,교시) 안에서 더 나중 기록이면 true — RPC의 `recorded_at desc, id desc`. */
function isNewer(a: AbsenceSubjectRow, b: AbsenceSubjectRow): boolean {
  const at = a.recorded_at ?? "";
  const bt = b.recorded_at ?? "";
  if (at !== bt) return at > bt;
  return a.id > b.id;
}

/**
 * 원시 출결 행 → 학생별 `{과목 키, 건수}`.
 *
 * 창(anchor−13일 ~ anchor) 필터는 **호출부(쿼리)**가 이미 걸었다고 본다 — 여기서 또 자르면 규칙이 두 곳이 된다.
 */
export function countAbsencesBySubject(rows: readonly AbsenceSubjectRow[]): AbsenceSubjectCounts {
  // ① 유효 행 — (학생,반,수업일,교시)별 최신 1건. 교시 null은 그 자체로 하나의 그룹(RPC의 distinct on과 동일).
  const effective = new Map<string, AbsenceSubjectRow>();
  for (const row of rows) {
    const key = `${row.student_id} ${row.class_id} ${row.session_date} ${row.slot_start ?? ""}`;
    const prev = effective.get(key);
    if (!prev || isNewer(row, prev)) effective.set(key, row);
  }

  // ② 결석인 유효 행의 (반, 수업일) 쌍을 학생×과목으로 센다. 같은 날 두 반을 빠지면 2회(0221a 주석).
  const seenPairs = new Set<string>();
  const perStudent = new Map<string, Map<string, number>>();
  for (const row of effective.values()) {
    if (row.status !== "absent") continue;
    const pair = `${row.student_id} ${row.class_id} ${row.session_date}`;
    if (seenPairs.has(pair)) continue; // 교시가 여럿이어도 그 반의 그날은 1회
    seenPairs.add(pair);
    const subject = row.subject?.trim() ? row.subject.trim() : "";
    const bucket = perStudent.get(row.student_id) ?? new Map<string, number>();
    bucket.set(subject, (bucket.get(subject) ?? 0) + 1);
    perStudent.set(row.student_id, bucket);
  }

  const out: AbsenceSubjectCounts = new Map();
  for (const [studentId, bucket] of perStudent) {
    out.set(
      studentId,
      [...bucket]
        .map(([subject, count]) => ({ subject, count }))
        .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject)),
    );
  }
  return out;
}
