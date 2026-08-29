/**
 * 결석 **사유 요약**과 **사전 통보** 가르기 — 순수 함수(Vitest).
 *
 * 원장 2026-08-29: *"운영실 출결 보고시에 사유까지 정리해서. 미리입력된 가족여행등 사유는 적절히 필터링"*.
 *
 * 🔴 **"N회"는 건드리지 않는다**(원장이 고른 방식). 그 숫자는 RPC `dashboard_absence_risk_admin`(0221a)의
 *    사실이고 결석 마일스톤 알림도 같은 값을 쓴다 — 여기서 깎으면 화면과 알림이 갈린다. 대신 **옆에 갈라서**
 *    보여준다: `결석 5회 · 사전 통보 5 · 가족여행`. 그러면 원장이 "이건 양해된 결석"임을 바로 읽는다.
 *    실측(2026-08-29 위험 19명): 이강우·이지호A는 **5회가 전부 사전 통보**인데 상위에 올라와 있었다.
 *
 * 🔑 **사전 통보 판별은 두 갈래의 합집합** — 어느 하나로는 부족하다:
 *   ① 사유에 `(데스크 접수)` — 데스크가 학부모 연락을 받아 적은 표식(실측 90일 68건)
 *   ② `recorded_at`(KST 날짜) < `session_date` — 수업일 **전에** 찍은 것(실측 39건)
 *   ①만 보면 강사가 미리 찍은 건을 놓치고, ②만 보면 당일 아침에 데스크가 접수한 건을 놓친다.
 *
 * ⚠️ **사유 원문은 화면에만 쓰고 AI 프롬프트엔 넣지 않는다**(호출부 규약) — 자유 텍스트라 무엇이 적힐지
 *    통제할 수 없고 실제로 `병결(입원)`·`병원 진료` 같은 건강 정보가 들어 있다. 매니저 보고가 판단하는 데
 *    필요한 건 "양해된 결석인가"이지 "왜"가 아니므로 **건수만** 넘긴다.
 */
import { effectiveAbsences, type AbsenceSubjectRow } from "./absence-subjects";

/** 데스크가 사전 접수했다는 표식 — 실측상 항상 이 형태로 붙는다. */
const DESK_MARK = "(데스크 접수)";
/** 화면 한 줄에 넣을 사유 개수(중복 제거 후). 실측상 사유의 61%가 6자 이하라 셋이면 충분히 짧다. */
const MAX_REASONS = 3;
/** 사유 한 건의 표시 길이 상한 — 실측 21자+는 18건뿐이고 대개 문장형이라 잘라도 뜻이 남는다. */
const MAX_REASON_CHARS = 16;

export type AbsenceReasonSummary = {
  /** 사전 통보(양해된) 결석 건수. `absences`에서 이만큼이 "미리 알린 것"이다. */
  preNotified: number;
  /** 사유 요약 — 중복 제거·`(데스크 접수)` 제거·상위 N. 사유가 하나도 없으면 빈 배열. */
  reasons: string[];
  /** 사유가 비어 있던 건수(실측상 결석의 약 40%) — "사유 없음"을 정직하게 셀 수 있게. */
  withoutReason: number;
};

/**
 * 사유 원문 → 표시용 한 조각.
 * `가족여행 (데스크 접수)` → `가족여행` (접수 표식은 `preNotified` 숫자가 이미 말한다 — 두 번 말하지 않는다).
 * 여러 줄이면 첫 줄만(실측: `가족여행 (데스크 접수)\n개인 사정 (데스크 접수)` 같은 행이 있다).
 */
export function normalizeReason(raw: string | null | undefined): string {
  const firstLine = String(raw ?? "").split(/[\r\n]+/)[0] ?? "";
  const withoutMark = firstLine.split(DESK_MARK).join(" ");
  const tidy = withoutMark.replace(/\s+/g, " ").trim();
  if (tidy === "") return "";
  return tidy.length > MAX_REASON_CHARS ? `${tidy.slice(0, MAX_REASON_CHARS)}…` : tidy;
}

/** 이 결석이 **미리 알린 것**인가 — 두 갈래 중 하나라도 맞으면 그렇다(위 주석 참조). */
export function isPreNotified(row: Pick<AbsenceSubjectRow, "note" | "recorded_at" | "session_date">): boolean {
  if ((row.note ?? "").includes(DESK_MARK)) return true;
  const recordedAt = row.recorded_at;
  if (!recordedAt) return false;
  // 🔴 KST 날짜로 비교한다 — recorded_at은 UTC 타임스탬프라 그냥 자르면 한국 저녁이 전날로 밀려
  //    "미리 찍었다"가 거짓으로 늘어난다.
  const kstDate = new Date(new Date(recordedAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return kstDate < row.session_date;
}

/**
 * 학생별 사유 요약. 세는 단위는 과목 분해와 **같은 것**(`effectiveAbsences`)이라
 * `preNotified + (그 밖) = absences`가 항상 성립한다.
 */
export function summarizeAbsenceReasons(
  rows: readonly AbsenceSubjectRow[],
): Map<string, AbsenceReasonSummary> {
  const per = new Map<string, { pre: number; blank: number; seen: Set<string>; order: string[] }>();
  for (const row of effectiveAbsences(rows)) {
    const bucket =
      per.get(row.student_id) ?? { pre: 0, blank: 0, seen: new Set<string>(), order: [] as string[] };
    if (isPreNotified(row)) bucket.pre += 1;
    const reason = normalizeReason(row.note);
    if (reason === "") bucket.blank += 1;
    else if (!bucket.seen.has(reason)) {
      bucket.seen.add(reason);
      bucket.order.push(reason);
    }
    per.set(row.student_id, bucket);
  }

  const out = new Map<string, AbsenceReasonSummary>();
  for (const [studentId, bucket] of per) {
    out.set(studentId, {
      preNotified: bucket.pre,
      reasons: bucket.order.slice(0, MAX_REASONS),
      withoutReason: bucket.blank,
    });
  }
  return out;
}

/**
 * 스포트라이트 한 줄에 붙일 꼬리표 — `· 사전 통보 5 · 가족여행`.
 *
 * 🔴 문장은 여기서만 만든다(화면·프롬프트가 각자 조립하면 표기가 갈린다).
 * ⚠️ `forPrompt`면 **사유 원문을 뺀다** — 파일 머리 주석의 AI 전송 규약.
 */
export function absenceReasonTail(
  summary: AbsenceReasonSummary | undefined,
  opts: { forPrompt?: boolean } = {},
): string {
  if (!summary) return "";
  const parts: string[] = [];
  if (summary.preNotified > 0) parts.push(`사전 통보 ${summary.preNotified}`);
  if (!opts.forPrompt && summary.reasons.length > 0) parts.push(summary.reasons.join("·"));
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

/**
 * **사전 통보로 설명되지 않는 결석 수** — "살펴볼 학생" 목록에 올릴지 정하는 값.
 *
 * 원장 2026-08-29(후속): *"사전통보는 살펴볼 학생 리스트에서 배제시켜. 결석과 사전통보가 똑같은데
 * 의미 없음."* 같은 날 앞선 결정("숫자는 깎지 말고 옆에 갈라서 보여주기")을 화면으로 확인한 뒤의
 * 판단이다 — 갈라서 보여줘도 `결석 5회 · 사전 통보 5`가 상위에 앉아 있으면 볼 게 없다.
 *
 * 🔴 **표시되는 "N회"는 여전히 안 깎는다.** 그 숫자는 RPC(0221a)의 사실이고 결석 마일스톤 알림도
 *    같은 값을 쓴다 — 깎으면 화면과 알림이 갈린다. 바뀌는 건 **목록에 넣을지**뿐이다.
 * 🔴 요약이 없으면(조회 실패·미조회) **빼지 않는다** — 모르는 것을 "양해됐다"로 읽으면 진짜 위험한
 *    학생이 조용히 사라진다(사전 통보 0으로 떨어져 그대로 남는다).
 * ⚠️ 두 숫자는 **출처가 다르다**(N회 = RPC, 사전 통보 = 출결 행) — 창이 어긋나 음수가 될 수 있어
 *    0으로 바닥을 친다.
 */
export function unexplainedAbsences(
  absences: number,
  summary: AbsenceReasonSummary | undefined,
): number {
  return Math.max(0, absences - (summary?.preNotified ?? 0));
}
