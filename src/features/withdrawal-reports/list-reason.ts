import { REASON_DETAILS, reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { REASON_LABEL, normalizeReason, type WithdrawalReason } from "@/features/withdrawals/types";

/**
 * 퇴원보고서 목록의 '퇴원 사유' 칸(원장 2026-10-16 *"퇴원 보고서 리스트에서도 사유 확인 가능하게"* ·
 * *"우리가 만든 사유가 있으면 그대로 쓰고 없으면 기타 (설명 입력)"*) — 순수 · Vitest.
 *
 * - 웹 보고서 = 작성 강사가 고른 우리 사유(`body.reason`) 그대로 · '기타'면 상세 사유가 곧 설명.
 * - 기존 스프레드시트 기록 = 옛 양식의 사유 글(선택지 28가지)을 **같은 뜻의 우리 사유**(대분류 · 세부)로 읽는다.
 *   뜻이 하나로 안 정해지는 글(두 사유를 한 칸에 묶은 것 등)·표에 없는 글은 지어 붙이지 않고 '기타 (원문)'.
 *   원문 사유가 '기타'·빈칸이면 상세 사유가 설명이다.
 * 🔴 표시 전용이다 — 원문(`fields`)도 학생의 퇴원 사유도 바꾸지 않는다.
 */
export type ListReason = { text: string; note: string | null; muted?: boolean };

const fold = (s: string) => s.replace(/\s+/g, "");

/** `note` = 맞는 세부가 없을 때 사유 아래에 붙는 설명(기타의 설명 줄과 같은 자리 · 원장 2026-10-16). */
type SheetReason = { reason: WithdrawalReason; detail?: string; note?: string };

/** 옛 양식 사유 글(공백 뺀 모양) → 우리 사유. 2026-10-16 운영 원문 421건의 사유 글 전수에서 뜻이 하나인 것만. */
export const SHEET_REASONS: Readonly<Record<string, SheetReason>> = {
  강사교체: { reason: "dissatisfaction", detail: "teacher_reassigned" },
  잦은강사교체불만: { reason: "dissatisfaction", detail: "teacher_changes" },
  잦은강사변경: { reason: "dissatisfaction", detail: "teacher_changes" },
  강사퇴사: { reason: "dissatisfaction", detail: "teacher_left" },
  수업방식이본인과맞지않아서: { reason: "dissatisfaction", detail: "teaching_style" },
  반레벨과맞지않음: { reason: "dissatisfaction", detail: "class_grouping" },
  학원관리미흡: { reason: "dissatisfaction", detail: "care_lacking" },
  선생님과맞지않아서: { reason: "dissatisfaction" },
  // 원장 2026-10-16 *"수업·강사 (힘듦)"* — 수업·강사엔 '힘듦' 세부가 없어 설명으로.
  수업진행이빡세서: { reason: "dissatisfaction", note: "힘듦" },
  "학습부진,수업따라오기벅참": { reason: "motivation", detail: "struggling" },
  학업의욕상실: { reason: "motivation", detail: "low_motivation" },
  시험성적이기대만큼안나옴: { reason: "grades", detail: "score_stalled" },
  학교성적이떨어져서: { reason: "grades", detail: "school_grades" },
  이사및전학: { reason: "relocation" },
  방학휴원: { reason: "schedule", detail: "travel_vacation" },
  거리가멀어서: { reason: "schedule", detail: "distance_shuttle" },
  타학원과시간이안맞음: { reason: "schedule", detail: "other_academy_conflict" },
  수학학원시간표충돌: { reason: "schedule", detail: "other_academy_conflict" },
  친구따라타학원이동: { reason: "competitor", detail: "with_friends" },
  타학원이동: { reason: "competitor" },
  진로변경: { reason: "career" },
  기타진로변경: { reason: "career" },
  고3이라마지막수업: { reason: "graduated" },
};

// 우리 라벨과 똑같이 적은 글(`이사`·`잦은 강사 변경`)도 그 사유로 — 새로 생기는 글이 표에 없어도 맞으면 그대로 쓴다.
// ⚠️ 두 대분류에 같은 이름의 세부가 있으면(`친구 따라` = 타 학원으로 이동 · 가족·친구) 어느 쪽인지 모르니 쓰지 않는다.
const LABELS = (() => {
  const all = [
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([reason, label]) => [fold(label), { reason }] as const),
    ...(Object.entries(REASON_DETAILS) as [WithdrawalReason, readonly { key: string; label: string }[]][]).flatMap(([reason, list]) =>
      list.map((d) => [fold(d.label), { reason, detail: d.key }] as const),
    ),
  ];
  const seen = new Map<string, number>();
  for (const [k] of all) seen.set(k, (seen.get(k) ?? 0) + 1);
  return new Map<string, SheetReason>(all.filter(([k]) => seen.get(k) === 1));
})();

const text = (reason: WithdrawalReason, detail?: string | null) => {
  const d = reasonDetailOf(detail);
  return d && d.reason === reason ? `${REASON_LABEL[reason]} · ${d.label}` : REASON_LABEL[reason];
};
const firstLine = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ") || null;
const other = (note: string | null): ListReason => ({ text: REASON_LABEL.other, note });

/** 기존 스프레드시트 기록 — 원문 사유 글 · 상세 사유 → 목록 칸. */
export function archiveReason(rawReason: string | null | undefined, rawDetail: string | null | undefined): ListReason {
  const raw = firstLine(rawReason);
  const key = raw ? fold(raw) : "";
  const hit = (Object.hasOwn(SHEET_REASONS, key) ? SHEET_REASONS[key] : undefined) ?? LABELS.get(key);
  if (hit && hit.reason !== "other") return { text: text(hit.reason, hit.detail), note: hit.note ?? null };
  // 원문이 '기타'·빈칸 = 상세 사유가 설명 · 그 밖의 글 = 그 글이 설명(우리 사유로 바꾸지 않는다).
  if (raw && !hit) return other(raw);
  const detail = firstLine(rawDetail);
  if (!raw && !detail) return { text: "미기재", note: null, muted: true };
  return other(detail);
}

/** 웹 보고서 — 고른 사유 · 상세 사유 → 목록 칸. 작성 요청만 받고 아직 아무것도 안 적은 보고서는 '작성 전'. */
export function webReportReason(status: string, reason: string | null | undefined, detail: string | null | undefined, reasonDetail?: string | null): ListReason {
  const key = normalizeReason(reason);
  const note = firstLine(detail);
  if (status === "requested" && (!key || key === "other") && !note) return { text: "작성 전", note: null, muted: true };
  if (!key) return { text: "미기재", note: null, muted: true };
  return key === "other" ? other(note) : { text: text(key, reasonDetail), note: null };
}
