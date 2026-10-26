// ① 기록된 분류 글 → 우리 대분류(코드 기준선, 순수). 뜻이 하나로 안 정해지는 글은 null(모델·사람이 자유 글로 고른다).
// 원본 보고서 '퇴원사유' = 앱의 SHEET_REASONS(퇴원보고서 목록이 쓰는 표) 그대로 · 메이크에듀 분류 = 아래 표(2026-10-26 238명 전수에서 뜻이 하나인 것만).
import { SHEET_REASONS } from "@/features/withdrawal-reports/list-reason";
import type { WithdrawalReason } from "@/features/withdrawals/types";
import type { WdRecord } from "./card";

type Hit = { reason: WithdrawalReason; detail?: string; memo?: string };
const fold = (s: string) => s.replace(/\s+/g, "");

const MAKEEDU: Readonly<Record<string, Hit>> = {
  수업방식이안맞아서: { reason: "dissatisfaction", detail: "teaching_style" },
  학교성적이떨어져서: { reason: "grades", detail: "school_grades" },
  강사교체: { reason: "dissatisfaction", detail: "teacher_reassigned" },
  멀어서: { reason: "schedule", detail: "distance_shuttle" },
  친구따라이동: { reason: "competitor", detail: "with_friends" },
  선생님과안맞아서: { reason: "dissatisfaction" },
  이사: { reason: "relocation" },
  // 규칙 8 — 같은 학원 계열 고등부로 옮김. 강사 평가에서 뺄지는 원장 확인 대상(지금은 '기타' + 메모).
  고등수학관이동: { reason: "other", memo: "고등수학관 이동" },
};
// 원본 양식에만 있는 글(SHEET_REASONS 밖) — 같은 규칙 8.
const ARCHIVE_EXTRA: Readonly<Record<string, Hit>> = { 고등수학관이동: { reason: "other", memo: "고등수학관 이동" } };

/** 메이크에듀 사유 `분류(상세)` → 괄호 앞 분류 글. */
export function makeeduCategory(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  const i = s.indexOf("(");
  return (i < 0 ? s : s.slice(0, i)).trim();
}

export type Recorded = { src: string; text: string; hit: Hit | null };

/** 이번 퇴원의 기록된 분류들(메이크에듀 + 같은 퇴원·날짜 모름 원본) — 각각 코드가 읽은 대분류(없으면 null). */
export function recordedCategories(r: WdRecord): Recorded[] {
  const out: Recorded[] = [];
  const mk = makeeduCategory(r.sources.makeedu?.reasonRaw);
  if (mk) out.push({ src: "mk", text: mk, hit: MAKEEDU[fold(mk)] ?? null });
  for (const a of r.sources.archives) {
    if (a.thisWithdrawal === "다른 때(과목 종료 등)") continue;
    const t = (a.fields["퇴원사유"] ?? "").trim();
    if (!t) continue;
    const k = fold(t);
    const sheet = Object.hasOwn(SHEET_REASONS, k) ? SHEET_REASONS[k] : undefined;
    out.push({ src: `a:${a.aid}:퇴원사유`, text: t, hit: sheet ? { reason: sheet.reason, detail: sheet.detail } : ARCHIVE_EXTRA[k] ?? null });
  }
  return out;
}

/** 기록된 분류가 가리키는 대분류 집합(읽힌 것만). 둘 이상이면 기록끼리 어긋난다. */
export function recordedReasons(r: WdRecord): WithdrawalReason[] {
  return [...new Set(recordedCategories(r).map((x) => x.hit?.reason).filter((x): x is WithdrawalReason => !!x))];
}
