/**
 * 수업보고서 1건의 **유일성 단위** — 반(수업)이 있으면 반, 없으면 과목.
 *
 * 원장 확정(2026-07-22): "보고서 2건 가야지. 수강한 수업마다 1건씩."
 * 같은 날 정규 수학 + 수학 특강을 들으면 보고서가 2건이고, 서로 덮어쓰지 않아야 한다.
 *
 * 🔴 이 규약은 **세 곳에 같은 식으로 존재한다.** 하나만 바꾸면 조용히 갈라진다:
 *   ① DB 생성열 `lesson_reports.unit_key` = `coalesce(class_id::text, subject)` (0134a)
 *      → `(tenant_id, student_id, report_date, unit_key)` 유니크가 덮어쓰기를 막는다.
 *   ② RPC `onescreen_prior_reports`의 `distinct on` 키 (0135a)
 *   ③ 이 파일 — 로스터가 DB 행을 화면 행에 붙일 때.
 *
 * 반이 없는 보고서가 **정상적으로** 존재한다: 이관분(반 정보 자체가 없음)·보강/수업외 수동 추가·
 * 관리자 직접작성(반이 모호할 때)·0134a 이전에 저장된 행. 그때는 과목이 단위 = 예전과 동일 동작이다.
 */

import { LEGACY_REPORT_SUBJECT } from "@/features/timetable/lib/report-subject";

/** 반 우선, 없으면 과목. 둘 다 없으면 null("단위를 특정할 수 없음" — DB에선 NULLS DISTINCT라 제약 밖). */
export function reportUnitKey(
  classId: string | null | undefined,
  subject: string | null | undefined,
): string | null {
  const c = classId?.trim();
  if (c) return c;
  const s = subject?.trim();
  return s ? s : null;
}

/** 화면의 과목 행(로스터가 만든 것) — 매칭에 필요한 만큼만. */
export type SubjectRowRef = {
  classId?: string | null;
  subjectKey?: string | null;
  /** 특강 반인가(`classes.is_special`). 켜지면 **그 반으로 확정된 보고서만** 붙는다(아래 2·3차 제외). */
  isSpecial?: boolean;
};
/** DB 보고서 행 — 매칭에 필요한 만큼만. */
export type ReportRowRef = {
  classId?: string | null;
  subject?: string | null;
  /**
   * 보강(수업외) 보고서인가(`lesson_reports.makeup`). 보강은 `class_id`가 NULL이라 2·3차 과목 폴백이
   * **정규 반 행에 오배정**한다(안 보낸 정규 보고서가 보강의 발송상태로 잠기는 버그, 2026-07-24 적대검수).
   * → 폴백에서 `!makeup`으로 걸러 보강 보고서는 어느 정규/이관 행에도 붙지 않게 한다(보강 행은 로스터가
   *   재구성하지 않는 임시 클라 행이라, 매칭 대상이 아니다 = 깨끗이 orphan → 재추가 시 buildMakeupStudent가 복원).
   */
  makeup?: boolean | null;
};

/**
 * 한 학생의 **화면 행들**에 그 학생의 **DB 보고서 행들**을 1:1로 붙인다. 반환은 rows와 같은 길이·순서.
 *
 * 매칭 순서(앞 단계가 이기고, 소비된 보고서는 뒤 단계에서 다시 안 잡힌다):
 *  1차 **반 정확매칭** — `report.classId === row.classId`. 정규/특강이 갈리는 유일한 축이다.
 *  2차 **과목 매칭(반 없는 보고서)** — 관리자 직접작성·0134a 이전 저장분·이관분 중 과목이 있는 행.
 *      같은 과목 행이 둘이면 **앞 행이 가져간다**(로스터가 반 시작시각 순으로 정렬하므로 결정적).
 *  3차 **과목도 없는 보고서(이관분)** — `legacyFallback`이 켜졌고 학생이 단일 과목일 때만.
 *      다과목 학생은 어느 과목인지 알 수 없어 붙이지 않는다(엉뚱한 과목에 남의 진도 주입 금지 —
 *      roster의 기존 보수 규약 유지).
 *
 * 🔴 **3차는 기본 꺼짐이고 '직전 회차'에서만 켠다.** ijw 이식분은 subject가 거의 다 비어 있어
 *    (실측 17,337/17,345 NULL) 이 폴백이 없으면 참고행·교재 승계가 통째로 0건이 된다. 그러나
 *    **당일 행에 켜면 안 된다** — edutrix 동기화가 오늘 날짜 이관분을 계속 넣는다(실측 최근 14일 870행,
 *    최신 2026-07-21). 켜면 강사가 쓰지도 않은 남의 보고서가 "이미 저장됨"으로 붙고 그 본문이 초안으로
 *    로드된다. 예전 코드도 당일 행엔 이 폴백이 없었다(키가 달라 자연히 안 걸렸을 뿐이다).
 *
 * 🔴 **한 보고서를 두 행에 붙이면 안 된다.** 붙이면 두 행이 같은 DB 행을 가리키게 되고, 각각 저장할 때
 *    서로를 덮어쓴다(이 작업이 없애려던 바로 그 버그가 화면 쪽에서 재현된다). 그래서 소비(consume)한다.
 */
export function matchReportsToRows<R extends ReportRowRef>(
  rows: readonly SubjectRowRef[],
  reports: readonly R[],
  opts?: { legacyFallback?: boolean },
): (R | undefined)[] {
  const out: (R | undefined)[] = rows.map(() => undefined);
  const used = new Set<R>();

  const take = (pred: (r: R) => boolean): R | undefined => {
    for (const r of reports) {
      if (!used.has(r) && pred(r)) {
        used.add(r);
        return r;
      }
    }
    return undefined;
  };

  // 1차 — 반 정확매칭.
  rows.forEach((row, i) => {
    const cls = row.classId?.trim();
    if (!cls) return;
    out[i] = take((r) => (r.classId?.trim() ?? "") === cls);
  });
  // 2차 — 반이 없는 보고서를 과목으로. ⚠️ **특강 행 + 보강 보고서는 제외**(아래 규칙).
  //    보강 보고서(class_id NULL·makeup)는 과목만 같은 정규 행에 붙으면 그 행을 잠근다 → `!r.makeup`로 차단.
  rows.forEach((row, i) => {
    if (out[i] || row.isSpecial) return;
    const key = row.subjectKey?.trim();
    if (!key) return;
    out[i] = take((r) => !r.classId?.trim() && !r.makeup && (r.subject?.trim() ?? "") === key);
  });
  // 3차 — 과목도 반도 없는 이관분. 명시 opt-in(위 🔴) + **행들이 전부 같은 과목일 때만**.
  // ⚠️ 조건이 `rows.length === 1`이면 안 된다: 같은 과목 두 반으로 갈린 학생(정규+특강, 중복 수강행)이
  //    행 2개가 되는 순간 이관분 폴백이 통째로 꺼져 **이전 회차 참고·교재 승계가 0건**이 된다
  //    (실측 2026-07-22: 김지호 90행·최주원 75·이채은A 68·전주율 68·윤정인 62·주준호 36의 이력이 전부 사라짐).
  //    같은 과목뿐이면 "어느 과목인지" 모호하지 않으므로 **첫 행**에 준다 — roster의 학생단위 prev 폴백이
  //    `subjects[0]`에 붙이는 것과 같은 보수 규약이다. 다과목 학생(수학+영어)은 여전히 붙이지 않는다.
  //
  // 🔴 **정규/특강 분리(2026-07-23 원장 지시)**: 2·3차는 "반이 안 붙은 보고서"를 과목만 보고 붙이는
  //    폴백인데, 정규와 특강은 **같은 과목**이라 이 폴백이 둘을 구분하지 못한다. 실제로 특강 행의
  //    '이전 회차'에 정규 수업의 진도·교재가 떴다(정규 행이 1차에서 매칭되면 `findIndex(!v)`가
  //    가리키는 "첫 빈 행"이 특강 행이 되어 이관분을 가져갔다).
  //    → **특강 행은 1차(반 정확매칭)만 허용한다.** 근거: 이관분·반 없는 보고서는 전부 정규다
  //    (특강 반은 최근 생성 — 이관 시점에 없었다). 반대 방향(정규 행이 특강 보고서를 가져가는 것)은
  //    특강 보고서에 class_id가 항상 붙으므로 1차에서 정확히 갈린다.
  //    ⚠️ 특강 첫 수업에 '이전 회차'가 비는 건 **정상**이다 — 정규 진도를 빌려오는 것보다 낫다.
  //
  // 🔴🔴 **이관분의 과목(=math)과 같은 행에만 준다** (원장 제보 2026-07-29, 영어 강사 원스크린).
  //    `subjectKeys.size === 1`은 "학생이 단일 과목"이 아니라 "**이 강사에게 보이는 행이** 단일 과목"이다.
  //    로스터는 강사 담당 반만 싣기 때문에, 영어 강사에겐 수학도 듣는 학생조차 영어 행 하나로 보인다
  //    → 이 조건을 그냥 통과해 **수학 이관분이 영어 행의 '이전 회차'**로 붙었다(실측 2026-07-29:
  //    영어반 학생 249명 중 101명이 레거시 보고서 보유. 김수민 '가우스5-2-1'·김준영 '중3-1-1 인재원'·
  //    김지호 '5-1-3'이 영어 참고행·교재 칸에 그대로 떴다). 강사가 '가져오기'를 누르면 수학 진도·과제가
  //    영어 보고서 본문이 되어 학부모에게 나간다.
  //    ⚠️ 같은 버그를 **시간표 hover는 2026-07-27에 이미 막았다**(reportSubject() 단일 소스, 원장 지시
  //    "수학 시간표에서만 수학 내용이 호버링되게"). 원스크린만 남아 있었다 — 규칙을 그 상수로 통일한다.
  //    📌 영어도 eywa에서 발송되기 시작하면 그 보고서는 `subject='english'`를 갖고 들어와 1·2차에서
  //       정확히 갈리므로, 이 게이트는 영어 참고행을 영구히 막지 않는다.
  const subjectKeys = new Set(rows.map((r) => r.subjectKey?.trim() ?? ""));
  // 행 과목 미지정("")은 math 간주 — 진도 입력 분기·G2 배지(grid-row.tsx)와 같은 규약.
  const onlyRowSubject = subjectKeys.size === 1 ? [...subjectKeys][0]! || LEGACY_REPORT_SUBJECT : null;
  if (opts?.legacyFallback && onlyRowSubject === LEGACY_REPORT_SUBJECT) {
    const i = out.findIndex((v, idx) => !v && !rows[idx]!.isSpecial);
    // 보강 보고서는 과목·반 없이도 매칭 대상이 아니다(위 2차와 동일 이유) — `!r.makeup` 방어.
    if (i >= 0) out[i] = take((r) => !r.classId?.trim() && !r.subject?.trim() && !r.makeup);
  }
  return out;
}
