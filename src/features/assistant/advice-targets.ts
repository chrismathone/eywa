/**
 * 비서 의견의 대상 명단 · 지표 무결성(s2_0039 · 2026-11-09) — 원장 질문 '학생이 줄어드는 원인' 답 검토 + 독립 리뷰.
 * 대상은 조회문에 `{{대상}}` 자리로 쓰고 서버가 굳힌 명단으로 채운다(기준값 · 재측정 크론 모두). 일을 안 해도 좋아지는 지표는 거른다.
 */
import { z } from "zod";
import type { AdviceCheck } from "./advice";

/** 대상 명단 자리 — 서버가 굳힌 대상 id를 uuid 배열 글자로 채운다(`id = any({{대상}})` · 분모 `cardinality({{대상}})`). */
export const TARGET_TOKEN = "{{대상}}";
export const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 의견의 대상 명단(s2_0039) — 이번 조회로 찾은 id 전부. 서버가 굳혀 두고, 다시 잴 때 같은 명단으로 본다. */
export const TARGET_KINDS = ["student", "class", "teacher", "consultation"] as const;
export const AdviceTargetsSchema = z.object({
  kind: z.enum(TARGET_KINDS).describe("대상 종류 — student 원생 · class 반 · teacher 강사 · consultation 상담"),
  // 버전 비트를 보지 않는 uuid 모양(옛 자료·다른 생성기의 id도 받는다 — 리뷰 2026-11-09).
  ids: z.array(z.string().regex(UUID_SHAPE, "uuid 모양이 아닙니다")).min(1).max(500).describe("대상 id 전부(이번 조회로 찾은 그대로)"),
});
export type AdviceTargets = z.infer<typeof AdviceTargetsSchema>;

const codeOf = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 일을 안 해도 좋아지는 지표를 막는다(2026-11-09 답 검토 — '출석률 75% 미만 재원생 수'는 그 학생들이 퇴원해도 내려간다 · 리뷰 2026-11-09 우회 보강).
 * ① '오늘' 칸(on_roster_today · active_today)은 기간 지표에 못 쓴다(다시 잴 날의 오늘로 바뀐다) — 결과·실행 지표 모두.
 * ② 조회문에 uuid 글자가 있으면 대상 명단(targets)을 달아야 한다 — 명단은 `{{대상}}` 자리로 쓴다(결과·실행 지표 모두).
 * ③ 대상 명단을 달았으면 `{{대상}}` 자리를 써야 한다(서버가 굳힌 명단으로 채운다 — 90명이 넘어도 조회문이 길어지지 않게).
 * ④ 결과 지표 '내리면 좋음'은 지금 상태로 모집단을 거르면 안 된다 — 학생 상태(status·status_label · 재원·휴원·퇴원 값) · 퇴원 칸이 비었음
 *    (withdrawn_on·exit_kind is null) · 수업료 청구가 살아 있는 학생만(onto_tuition_months·invoices). 학생이 나가면 저절로 내려간다.
 * ⑤ 결과 지표 '오르면 좋음' 비율(percent)에 대상 명단이 있으면 분모는 대상 전원(`cardinality({{대상}})`) — 남은 학생·남은 수업만 분모로 두면
 *    나간 학생이 비율을 올린다(수업 단위 출석률도 같다 — 나간 학생의 수업이 빠진다).
 */
const STATE_FILTER =
  /\bstatus(?:_label)?\s*(?:::\s*text\s*)?(?:=|<>|!=|\bin\b|\bnot\s+in\b)\s*\(?\s*'(?:enrolled|on_hold|withdrawn|prospect|consulted|재원|휴원|퇴원|예비|상담완료)'|\b(?:withdrawn_on|withdrawn_at|exit_kind)\s+is\s+(?:not\s+)?null|\bon_hold\b|\bonto_tuition_months\b|\binvoices\b/i;
const UUID_IN_SQL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function checkIntegrityProblem(
  check: Pick<AdviceCheck, "sql" | "better" | "unit">,
  opts: { targets?: AdviceTargets | null; outcome: boolean },
): string | null {
  const code = codeOf(check.sql);
  if (/\b(on_roster_today|active_today)\b/i.test(code)) return "on_roster_today·active_today는 '오늘' 기준 칸이라 기간 지표에 쓸 수 없습니다 — 기간 명단 규칙으로 쓰세요";
  const usesTargets = code.includes(TARGET_TOKEN);
  if (opts.targets && !usesTargets) return `대상 명단을 달았으면 조회문에 ${TARGET_TOKEN} 자리를 쓰세요(예: s.id = any(${TARGET_TOKEN})) — 서버가 명단으로 채웁니다`;
  if (!opts.targets && usesTargets) return `${TARGET_TOKEN} 자리를 쓰려면 대상 명단(targets)을 달아야 합니다`;
  if (UUID_IN_SQL.test(code.split(TARGET_TOKEN).join("")) && !opts.targets) return "조회문에 id를 글자로 적었으면 그 대상을 targets로 달고 {{대상}} 자리로 쓰세요(다시 잴 때 같은 명단으로)";
  if (!opts.outcome) return null;
  if (check.better === "down" && STATE_FILTER.test(code)) {
    return "지금 상태(재원·휴원·퇴원 · 청구가 살아 있는 학생)로 거르는 '내리면 좋음' 지표는 학생이 나가도 내려가 좋아진 것처럼 보입니다 — 대상 명단을 고정하고 나간 학생도 나쁜 결과로 세세요";
  }
  if (check.better === "up" && check.unit === "percent" && opts.targets && !/cardinality\s*\(\s*\{\{대상\}\}\s*\)/.test(code)) {
    return `대상 명단이 있는 비율 지표는 분모를 대상 전원(cardinality(${TARGET_TOKEN}))으로 두세요 — 남은 학생만 분모로 두면 나간 학생이 비율을 올립니다`;
  }
  return null;
}

/** 대상 자리를 굳힌 명단으로 채운다(`array['…','…']::uuid[]`) — 명단은 uuid 모양만(검사를 지난 값) · 소문자. */
export function fillTargets(sql: string, ids: readonly string[] | null | undefined): string {
  if (!sql.includes(TARGET_TOKEN)) return sql;
  const safe = (ids ?? []).filter((id) => UUID_SHAPE.test(id)).map((id) => `'${id.toLowerCase()}'`);
  return sql.split(TARGET_TOKEN).join(`array[${safe.join(",")}]::uuid[]`);
}
