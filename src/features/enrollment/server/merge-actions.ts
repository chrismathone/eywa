"use server";

// 등록상담 병합 — 계획 조회(미리보기)와 실행. 값 판단은 전부 순수함수(planMerge)가 하고
// 여기서는 **권한·재계산·집행·감사**만 맡는다.
//
// 🔴 클라이언트가 보낸 값을 그대로 저장하지 않는다. 화면은 "어느 행의 값을 쓸지"(행 id)만 보내고
//    서버가 계획을 **다시 계산**해 그 행에서 값을 꺼낸다 — 임의 값 주입 경로를 아예 만들지 않는다.
import { consultOriginLabel } from "../consult-origin";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { moveCareToMergeWinner, revertCareMerge } from "@/features/student-care/server/merge-move";
import { moveJourneyToMergeWinner, revertJourneyMerge } from "@/features/enrollment/journey/merge-move";
import { COLUMN_LABEL } from "@/features/enrollment/merge-policy";
import { buildMergePatch, planMerge, type ConsultRow, type MergePlan } from "@/features/enrollment/merge-plan";
import { explainDbError } from "@/lib/supabase/db-error";

const DEFAULT_GAP_DAYS = 7;
/** 한 번에 합칠 수 있는 최대 건수 — `.in()`이 URL 길이로 죽는 것(B3)과, 사람이 검수 못 할 규모를 동시에 막는다. */
const MAX_MERGE_ROWS = 10;

type Gate =
  | { error: string; user?: undefined }
  | { error?: undefined; user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> };

async function requireMergeWrite(): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) {
    return { error: "신규 콜&상담 권한이 없습니다" };
  }
  return { user };
}

/** 병합 대상 행 + 자식 개수를 한 번에 — RLS 클라이언트라 같은 학원만 나온다. */
async function loadRows(ids: string[]) {
  const supabase = await createClient();
  const [{ data: rows, error }, ai, rec, push] = await Promise.all([
    supabase.from("enrollment_consultations").select("*").in("id", ids),
    supabase.from("consultation_ai_analysis").select("consultation_id, model_version").in("consultation_id", ids),
    supabase.from("consultation_recordings").select("consultation_id").in("consultation_id", ids),
    supabase.from("makeedu_push_requests").select("consultation_id, status").in("consultation_id", ids),
  ]);
  if (error) throw error; // 조회 실패를 '해당 없음'으로 위장하지 않는다
  const children: Record<string, { ai: number; rec: number; push: number }> = {};
  const bump = (id: string, k: "ai" | "rec" | "push") => {
    children[id] ??= { ai: 0, rec: 0, push: 0 };
    children[id]![k] += 1;
  };
  for (const r of ai.data ?? []) bump(r.consultation_id as string, "ai");
  for (const r of rec.data ?? []) bump(r.consultation_id as string, "rec");
  for (const r of push.data ?? []) bump(r.consultation_id as string, "push");
  const pending = (push.data ?? []).filter((r) =>
    ["pending", "running"].includes(String((r as { status?: string }).status)),
  ).length;
  const models: Record<string, string[]> = {};
  for (const r of ai.data ?? []) {
    const id = r.consultation_id as string;
    (models[id] ??= []).push(String((r as { model_version?: string }).model_version ?? ""));
  }
  return { rows: (rows ?? []) as ConsultRow[], children, pendingPush: pending, models };
}

export type MergePreview =
  | { error: string; plan?: undefined }
  | {
      error?: undefined;
      plan: MergePlan;
      rows: { id: string; label: string; outcome: string; consultedAt: string; source: string }[];
    };

/**
 * 출처 라벨은 [consult-origin.ts](../consult-origin.ts) 단일 소스.
 * 🔴 예전엔 여기서 `makeedu_id`만 보고 정해서, **우리가 makeedu로 보내고 받아 적은 counselSeq**까지
 *    "makeedu 연동"으로 불렀다 — 원장이 그걸 보고 왕복(되가져오기) 버그로 의심했다(2026-09-01).
 */
const sourceOf = (r: ConsultRow): string =>
  consultOriginLabel({
    legacyKey: (r.legacy_key as string | null) ?? null,
    makeeduId: (r.makeedu_id as string | null) ?? null,
    makeeduPushedAt: (r.makeedu_pushed_at as string | null) ?? null,
    fromPublicIntake: (r.from_public_intake as boolean | null) ?? null,
  });

/** 미리보기 — 화면이 그릴 계획을 서버에서 만든다(화면은 이 결과만 그린다). */
export async function previewConsultationMerge(ids: string[], forceWinnerId?: string): Promise<MergePreview> {
  const gate = await requireMergeWrite();
  if (gate.error) return { error: gate.error };
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length < 2) return { error: "병합하려면 상담을 2건 이상 골라야 합니다" };
  if (unique.length > MAX_MERGE_ROWS) return { error: `한 번에 ${MAX_MERGE_ROWS}건까지 합칠 수 있습니다` };

  const { rows, children, pendingPush, models } = await loadRows(unique);
  if (rows.length !== unique.length) return { error: "상담을 찾을 수 없습니다" };

  const plan = planMerge(rows, { children, maxDayGap: DEFAULT_GAP_DAYS, forceWinnerId });
  if (pendingPush > 0) {
    plan.blockers.push("makeedu 전송 대기 중인 상담이 있어 병합할 수 없습니다");
  }
  // 🔴 AI 분석은 (상담, 모델) 유니크라 **같은 모델 분석이 양쪽에 있으면 옮길 수 없다** — 남기는 쪽만 보존된다.
  //    이걸 안 알리면 "옮겨집니다"라고 해놓고 실제로는 버리는, 계획이 거짓말을 하는 화면이 된다.
  const winnerModels = new Set(models[plan.winnerId] ?? []);
  const dropped = plan.loserIds.flatMap((id) => (models[id] ?? []).filter((m) => winnerModels.has(m)));
  if (dropped.length > 0) {
    plan.warnings.push(
      `같은 AI 모델의 분석이 양쪽에 있어 ${dropped.length}건은 남기는 상담 쪽만 보존됩니다`,
    );
  }
  return {
    plan,
    rows: rows.map((r) => ({
      id: r.id,
      label: String(r.prospect_name ?? ""),
      outcome: String(r.outcome ?? ""),
      consultedAt: String(r.consulted_at ?? ""),
      source: sourceOf(r),
    })),
  };
}

export type MergeResult = { error?: string; ok?: true; winnerId?: string };

/**
 * 병합 실행. `choices`는 **행 id만** 담는다(항목 키 → 그 값을 가져올 행 id).
 * 사람이 골라야 하는 항목(conflict)이 하나라도 안 정해졌으면 실행하지 않는다 — 임의로 승자 값을 쓰지 않는다.
 */
export async function mergeConsultations(
  winnerId: string,
  loserIds: string[],
  choices: Record<string, string> = {},
): Promise<MergeResult> {
  const gate = await requireMergeWrite();
  if (gate.error) return { error: gate.error };

  const unique = [...new Set([winnerId, ...loserIds])].filter(Boolean);
  if (!winnerId || unique.length < 2) return { error: "병합 대상이 올바르지 않습니다" };
  if (unique.length > MAX_MERGE_ROWS) return { error: `한 번에 ${MAX_MERGE_ROWS}건까지 합칠 수 있습니다` };

  const { rows, children } = await loadRows(unique);
  if (rows.length !== unique.length) return { error: "상담을 찾을 수 없습니다" };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const winner = byId.get(winnerId);
  if (!winner) return { error: "남길 상담을 찾을 수 없습니다" };

  // 서버가 계획을 **다시 만든다** — 화면이 본 것과 같은 함수·같은 입력·같은 승자.
  const plan = planMerge(rows, { children, maxDayGap: DEFAULT_GAP_DAYS, forceWinnerId: winnerId });
  if (plan.blockers.length > 0) return { error: plan.blockers[0] };
  const targetLoserIds = plan.loserIds;

  // patch 조립은 순수 함수(buildMergePatch)에 둔다 — 병합은 되돌릴 수 없어서
  // "실제로 저장될 값"이 가장 중요한 검사 대상인데, 서버 액션 안에 있으면 테스트할 방법이 없다.
  const built = buildMergePatch(plan, rows, winnerId, choices);
  if (built.error !== undefined) {
    const miss = built.error.startsWith("MISSING_CHOICE:")
      ? built.error.slice("MISSING_CHOICE:".length)
      : null;
    return {
      error: miss ? `'${COLUMN_LABEL[miss] ?? miss}'을(를) 어느 쪽으로 남길지 정해주세요` : built.error,
    };
  }
  const patch = built.patch;
  const discarded = built.discarded.map((d) => ({ field: COLUMN_LABEL[d.key] ?? d.key, values: d.values }));

  // 상담 약속·인계(s2_0028·s2_0029)를 이긴 쪽 상담으로 먼저 옮긴다 — 진 쪽이 지워지면 등록 전 약속이 함께 지워진다. 못 옮기면 멈춘다(되돌릴 수 없다).
  if (!gate.user) return { error: "로그인이 필요합니다" };
  const winnerStudentId = winner.student_id ? String(winner.student_id) : null;
  // 병합 뒤 이긴 쪽의 학생 = 병합값에 학생 칸이 있으면 그 값(사람이 고른 쪽), 없으면 지금 값.
  const finalStudent = "student_id" in patch ? (patch as Record<string, unknown>).student_id : winnerStudentId;
  const care = await moveCareToMergeWinner({
    tenantId: gate.user.tenantId, actorId: gate.user.id, winnerId,
    finalStudentId: finalStudent ? String(finalStudent) : null, loserIds: targetLoserIds,
  });
  if (!care.ok) return { error: "상담 약속을 옮기지 못해 병합을 멈췄습니다. 잠시 뒤 다시 시도해 주세요. 바뀐 상담은 없습니다." };
  // 전화·방문·등록 기록(s2_0062)도 이긴 쪽 상담으로 — 진 쪽이 지워지면 기록이 함께 지워진다. 못 옮기면 약속도 되돌리고 멈춘다.
  const journey = await moveJourneyToMergeWinner(gate.user.tenantId, winnerId, targetLoserIds);
  if (!journey.ok) {
    await revertCareMerge(gate.user.tenantId, gate.user.id, care.moved);
    return { error: "전화·방문 기록을 옮기지 못해 병합을 멈췄습니다. 잠시 뒤 다시 시도해 주세요. 바뀐 상담은 없습니다." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_enrollment_consultations", {
    p_winner: winnerId,
    p_losers: targetLoserIds,
    p_patch: patch,
  });
  if (error) {
    // 병합이 안 됐으면 옮긴 약속도 되돌린다(진 쪽 상담이 그대로 남아 있다).
    await revertCareMerge(gate.user.tenantId, gate.user.id, care.moved);
    await revertJourneyMerge(gate.user.tenantId, journey.moved);
    return { error: explainDbError(error, { scope: "enrollment.merge-actions.mergeConsultations", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }

  await logAction({
    action: "consultation_merge",
    targetType: "enrollment_consultations",
    targetLabel: String(winner.prospect_name ?? ""),
    // 🔴 "무엇을 버렸나"가 되돌릴 유일한 근거다. 전사·브리프 같은 큰 본문은 빼고 버린 값만 남긴다.
    metadata: { winnerId, loserIds: targetLoserIds, discarded, result: data, ...(care.moved.length ? { careMoved: care.moved.map((m) => m.id) } : {}), ...(journey.moved.length ? { journeyMoved: journey.moved.map((m) => m.id) } : {}) },
  });

  revalidatePath("/enrollment");
  revalidatePath(`/enrollment/${winnerId}`);
  return { ok: true, winnerId };
}
