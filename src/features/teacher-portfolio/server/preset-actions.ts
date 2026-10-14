"use server";

// 강사평가 구성 저장·삭제(원장 2026-10-13 *"폼 저장? 불러오기?"*) — 설정 저장과 같은 문(evaluationWriteGate)을 지난 뒤에만.
// 불러오기는 화면에서 하고(목록은 면이 읽어 내려준다), 점수를 매기는 설정은 원장이 [저장]을 눌러야 바뀐다.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAction } from "@/features/audit/server/log";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluationConfigSchema, issueMessage, resolveEvaluationConfig } from "../evaluation/config";
import { deletePreset, PRESET_LIMIT, savePreset } from "./preset-store";
import { evaluationWriteGate } from "./write-gate";

export type PresetActionState = { ok: boolean; error?: string; notice?: string };

const nameSchema = z.string().trim().min(1, "구성 이름을 적어 주세요").max(30, "구성 이름은 30자까지입니다");
const failure = (e: unknown, fallback: string) => (e instanceof Error && e.message.includes("준비되지") ? e.message : fallback);

export async function saveEvaluationPreset(name: unknown, input: unknown): Promise<PresetActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0]?.message ?? "구성 이름을 확인해 주세요" };
  const parsed = evaluationConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(parsed.error) };
  const config = resolveEvaluationConfig(parsed.data);
  try {
    const result = await savePreset(createAdminClient(), gate.tenantId, parsedName.data, config, gate.userId);
    if (result === "full") return { ok: false, error: `구성은 ${PRESET_LIMIT}개까지 저장합니다. 안 쓰는 구성을 지우고 다시 저장해 주세요` };
  } catch (e) {
    reportWarning("강사평가 구성 저장 실패", { scope: "saveEvaluationPreset", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: failure(e, "구성을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요") };
  }
  await logAction({ action: "teacher_evaluation_preset_save", targetType: "teacher_portfolio", targetLabel: parsedName.data, metadata: { name: parsedName.data } });
  revalidatePath("/owner");
  return { ok: true, notice: `‘${parsedName.data}’ 구성으로 저장했습니다` };
}

export async function deleteEvaluationPreset(id: unknown): Promise<PresetActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "지울 구성을 찾지 못했습니다" };
  let name: string | null;
  try {
    name = await deletePreset(createAdminClient(), gate.tenantId, parsed.data);
  } catch (e) {
    reportWarning("강사평가 구성 삭제 실패", { scope: "deleteEvaluationPreset", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: failure(e, "구성을 지우지 못했습니다. 잠시 후 다시 시도해 주세요") };
  }
  if (!name) return { ok: false, error: "이미 지워진 구성입니다" };
  await logAction({ action: "teacher_evaluation_preset_delete", targetType: "teacher_portfolio", targetLabel: name, metadata: { name } });
  revalidatePath("/owner");
  return { ok: true, notice: `‘${name}’ 구성을 지웠습니다` };
}
