/**
 * '퇴원' 섹션 **한 줄 요약** — 순수 모듈(Vitest).
 *
 * 원장 2026-08-18: *"퇴원생은 이름 학교학년(예: 침산중2)만 표시, 뒤에는 필요 없음."*
 * → 이어서: *"날짜도 있어야겠네. **이름 학교학년 (퇴원일, 퇴원사유)** 정도."*
 *
 * 그전엔 퇴원 행에도 출결·유닛·태도·시험 점수·특이사항 칸이 **그려지기만 하고 전부 잠겨** 있어
 * `주. 08-18 — — —`처럼 쓸 수 없는 칸이 자리만 먹었다. 이제 그 칸들을 아예 안 그리고 한 줄로 접는다.
 *
 * 🔴 **접는 것은 빈 칸이지 기록이 아니다.** 퇴원 유예(30일) 안에는 "그만두기 직전 주에 찍힌 출결·태도"가
 *    남아 있을 수 있는데, 칸을 지우면서 그 값까지 화면에서 없애면 이 프로젝트가 반복해 밟은
 *    "쓴 게 증발했다"가 된다(grid.ts `hiddenSpecial` 각주와 같은 원칙). 그래서 값이 있으면 요약 줄
 *    뒤에 **읽기 전용 텍스트로 이어 붙인다** — 못 고치는 건 그대로지만 보이지 않는 일은 없다.
 * ⚠️ 여기는 문자열만 만든다(React 없음) — 주간 시트·오늘 면 두 표가 같은 문장을 쓰게 하는 게 목적이다.
 */

/** 그 퇴원 학생의 한 교시분 기록 — 값이 하나도 없으면 문장에서 통째로 빠진다. */
export type WithdrawnSlotRecord = {
  /** 교시 시작(HH:MM) — 교시가 둘 이상 값이 있을 때만 앞에 붙는다. */
  slotStart: string;
  /**
   * 출결 **표시 라벨**(호출부가 `attendanceLabelOf(status, lang)`으로 변환해 넘긴다 — raw enum 금지).
   * ⚠️ 2026-09-03부터 영어 화면에선 영어 라벨이 온다 — 이 모듈은 문자열을 **그대로 잇기만** 한다.
   */
  attendance?: string | null;
  /** 출결 사유 메모(지각·결석). */
  attendanceNote?: string | null;
  /** 태도(저장값 그대로 — 5단 눈금 한글, 옛 표기도 그대로 보인다). */
  attitude?: string | null;
  /** 특이사항(progress_note). */
  progressNote?: string | null;
  /** 폼별 자유 입력(시험 점수 / 듣기 레벨 · 누적 암기 단어수) — 라벨은 roster-form이 정한다. */
  extras?: readonly { label: string; value: string | null | undefined }[];
};

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * 요약 줄의 **이름 뒤 부분** — `학교학년 · (퇴원일, 퇴원사유)`.
 *
 * · 학교학년은 호출부가 `schoolGradeLabel`로 압축해 넘긴다("침산중2" — 공백 join 금지, 전역 규칙).
 * · 사유가 없으면 괄호 안에서 **사유만** 빠진다(`(08-18)`). 원장이 같은 지시에서 날짜를 명시로 요구했으니
 *   사유가 비었다고 날짜까지 지우지 않는다. 둘 다 없을 때만 괄호가 통째로 사라진다(빈 괄호 금지).
 * · 날짜는 화면 폭 때문에 **MM-DD**로 줄인다(전체 날짜는 호출부가 `title`에 남긴다).
 */
export function withdrawnSummaryText(input: {
  schoolGrade?: string | null;
  endedOn?: string | null;
  /** 표시용 한글 사유(호출부가 `reasonDisplay`를 거쳐 넘긴다 — 표준 코드 노출 금지). */
  reason?: string | null;
}): string {
  const schoolGrade = clean(input.schoolGrade);
  const endedOn = clean(input.endedOn);
  const reason = clean(input.reason);
  const day = endedOn ? (endedOn.length >= 10 ? endedOn.slice(5) : endedOn) : null;
  const paren = [day, reason].filter(Boolean).join(", ");
  return [schoolGrade, paren ? `(${paren})` : null].filter(Boolean).join(" · ");
}

/**
 * 문장 안에 끼는 낱말 둘 — 강사뷰 영어 화면에서 갈아 끼운다(호출부가 사전에서 읽어 넘긴다).
 * 🔴 기본값은 한국어라 **안 넘기는 기존 호출부는 한 글자도 안 바뀐다**.
 */
export type WithdrawnRowLabels = { reason: string; attitude: string };
const KO_LABELS: WithdrawnRowLabels = { reason: "사유", attitude: "태도" };

/** 한 교시분 기록을 사람이 읽는 한 조각으로 — 값이 없으면 null(문장에서 빠진다). */
function slotText(rec: WithdrawnSlotRecord, labels: WithdrawnRowLabels): string | null {
  const att = clean(rec.attendance);
  const note = clean(rec.attendanceNote);
  const parts: string[] = [];
  // 사유는 출결에 붙여 읽는다("결석(병결)") — 따로 떼면 무엇의 사유인지 모른다.
  if (att) parts.push(note ? `${att}(${note})` : att);
  else if (note) parts.push(`${labels.reason} ${note}`); // 상태가 지워지고 사유만 남은 옛 행도 보이게
  const attitude = clean(rec.attitude);
  if (attitude) parts.push(`${labels.attitude} ${attitude}`);
  for (const extra of rec.extras ?? []) {
    const v = clean(extra.value);
    if (v) parts.push(`${extra.label} ${v}`);
  }
  const progress = clean(rec.progressNote);
  if (progress) parts.push(progress);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 남아 있는 기록의 한 줄 표기 — 값이 하나도 없으면 **빈 문자열**(그때는 요약만 그린다).
 * 값이 있는 교시가 둘 이상이면 어느 교시인지 앞에 붙인다(하나뿐이면 군더더기라 안 붙인다).
 */
export function withdrawnRecordText(
  records: readonly WithdrawnSlotRecord[],
  labels: WithdrawnRowLabels = KO_LABELS,
): string {
  const filled = records
    .map((rec) => ({ slotStart: rec.slotStart, text: slotText(rec, labels) }))
    .filter((r): r is { slotStart: string; text: string } => r.text !== null);
  if (filled.length === 0) return "";
  if (filled.length === 1) return filled[0].text;
  return filled.map((r) => `${r.slotStart} ${r.text}`).join(" · ");
}
