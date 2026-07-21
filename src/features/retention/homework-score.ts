// 숙제 수행 상태 파서 — **수업보고서(`lesson_reports.homework_score`)가 숙제 신호의 단일 소스.**
//
// ⚠️ 배경(2026-07-21 실측): retention risk는 원래 `attendance_records.homework_required/done`(출석부 체크박스)만
// 봤는데 그 컬럼은 injaewon 개설 이래 **true인 행이 0건** — 아무도 쓰지 않는다. 그 결과 전원 `homeworkRate=null`
// → 전원 "숙제 기록 없음" 사유가 붙고, 그게 일일 브리핑 스포트라이트 재료로 흘러 원장 화면에 "숙제 기록 없음"이
// 사실과 반대로 보고됐다(같은 기간 김지호 90%·김지우 100%가 수업보고서에 멀쩡히 있었음).
//
// 값은 두 계보가 섞여 있다 — edutrix 임포트("100%"·"90%"·"50%"·"0%")와 원스크린 선택지(`HOMEWORK` = 완료/일부
// 미흡/미제출). 둘 다 0~100 이행률로 정규화한다. 미기재("—"·빈칸·null)는 **null(기록 없음)** 로, 0%(미제출)와 구분.

const WORD_SCORES: Record<string, number> = {
  완료: 100,
  "일부 미흡": 50,
  미흡: 50,
  미제출: 0,
};

/** "90%"·"완료"·"미제출" → 0~100 이행률. 해석 불가·미기재는 null(= 기록 없음, 0%와 다름). */
export function parseHomeworkScore(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s || s === "—" || s === "-") return null;
  const m = s.match(/^(\d{1,3})\s*%?$/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }
  return WORD_SCORES[s] ?? null;
}

/** 파싱 가능한 값들의 평균(0~100). 하나도 없으면 null. */
export function averageHomeworkScore(values: (string | null | undefined)[]): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    const parsed = parseHomeworkScore(v);
    if (parsed == null) continue;
    sum += parsed;
    n++;
  }
  return n === 0 ? null : sum / n;
}
