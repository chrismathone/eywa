/**
 * 결석 접수 → **담당 강사 벨** 문구(순수 · Vitest).
 *
 * 이 벨의 목적은 알림이 아니라 **이중 처리 차단**이다. 담임이 "결석인데 왜 아무 말이 없지"에서 출발해
 * 학부모에게 다시 전화하거나, 자기 출석부에서 같은 칸을 또 손대는 걸 막는다 —
 * 그래서 문구는 사실(누가·언제·왜)과 함께 **"더 하실 일 없습니다"**를 분명히 말한다.
 *
 * 🔴 날짜는 **목록**으로 적는다([[#100]]). "19일·21일"을 "19~21일"로 뭉치면 20일에 오는 아이가
 *    결석으로 읽힌다 — 그릇이 표현 못 하는 입력은 에러가 아니라 조용한 손실로 나온다.
 */

/** "2026-08-19" → "8/19". 연도는 뺀다(벨 제목은 짧을수록 읽힌다 — 먼 미래는 접수 자체가 31일 상한). */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${Number(m)}/${Number(d)}`;
}

/**
 * 날짜 목록 표기 — 1~3개는 그대로 나열, 4개 이상은 "첫날 외 N일".
 * ⚠️ 구간(`~`)으로 줄이지 말 것: 사이에 수업이 있는 날이 섞이면 사실이 아니게 된다.
 */
export function formatIntakeDates(dates: readonly string[]): string {
  const uniq = [...new Set(dates.filter(Boolean))].sort();
  if (uniq.length === 0) return "";
  if (uniq.length <= 3) return uniq.map(shortDate).join("·");
  return `${shortDate(uniq[0]!)} 외 ${uniq.length - 1}일`;
}

/** 반 이름 표기 — 3개까지 나열하고 넘으면 "외 N개"(벨 본문이 길어지면 안 읽힌다). */
export function formatIntakeClasses(names: readonly string[]): string {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length === 0) return "";
  if (uniq.length <= 3) return uniq.join("·");
  return `${uniq.slice(0, 3).join("·")} 외 ${uniq.length - 3}개`;
}

export function buildIntakeAlert(input: {
  studentName: string;
  dates: readonly string[];
  classNames: readonly string[];
  /** 학부모가 말한 사유(메모로도 저장된 그 문장). 없으면 사유 없이. */
  reason: string | null;
  /** 접수한 직원 이름 — "누가 처리했나"가 있어야 되물을 곳이 분명해진다. */
  byName: string | null;
}): { title: string; body: string } {
  const when = formatIntakeDates(input.dates);
  const title = `${input.studentName} 결석 접수${when ? ` · ${when}` : ""}`;
  const parts = [
    formatIntakeClasses(input.classNames),
    input.reason?.trim() || null,
    // 🔴 이 문장이 이 기능의 핵심 — 담임이 같은 건을 또 처리하지 않게 한다.
    `데스크${input.byName ? `(${input.byName})` : ""}가 학부모 연락을 받아 출석부에 결석으로 입력했습니다 — 따로 처리하실 것 없습니다.`,
  ].filter(Boolean);
  return { title, body: parts.join(" · ") };
}
