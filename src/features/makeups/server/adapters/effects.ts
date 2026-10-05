import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingMakeupRpc, parseCommandSuccess, participationCommandId } from "../../command-parse";
import { acceptedEffectGap } from "../../effect-gap";
import {
  judgeSqlProjection, parseSqlProjection, type ProjectionEvidence, type ProjectionRetryResult, type SqlProjection,
} from "../../projection-evidence";

export type EffectGap = {
  effectKey: string;
  kind: string;
  participantId: string | null;
  reservationId: string | null;
  error: string;
  queued: boolean;
};

/** 실패·관측을 기록한다. 본문이 queued·id·effect_key·kind 를 갖춰야 대기열에 들어간 것이다. */
export async function noteEffectGap(gap: Omit<EffectGap, "queued">): Promise<EffectGap> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("makeup_note_effect_gap", {
      p_gap: {
        effect_key: gap.effectKey, kind: gap.kind, participant_id: gap.participantId,
        reservation_id: gap.reservationId, error: gap.error,
      },
    });
    const queued = !error && acceptedEffectGap(data, { effectKey: gap.effectKey, kind: gap.kind });
    return { ...gap, queued };
  } catch {
    return { ...gap, queued: false };
  }
}

export function effectGapsOf(units: object): EffectGap[] {
  const raw = (units as { effectGaps?: EffectGap[] }).effectGaps;
  return Array.isArray(raw) ? raw : [];
}

export type ParticipationSend =
  | { ok: true; replayed: boolean; projectionState: "pending" | "done" | "failed" | null; verificationCode: string | null; verificationOk: boolean }
  | { ok: false; error: string };

function actorText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const actor = value.trim();
  return actor.length > 0 ? actor : null;
}

/** 명령 id 의 주체는 세션이다. 페이로드의 강사 칸은 귀속이지 로그인 주체가 아니다. */
async function authenticatedActorId(db: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  try {
    const { data } = await db.auth.getClaims();
    const sub = actorText(data?.claims?.sub);
    if (sub) return sub;
  } catch {
    /* 로컬 검증이 없으면 세션 조회로 넘어간다. */
  }
  try {
    const { data } = await db.auth.getUser();
    return actorText(data.user?.id);
  } catch {
    return null;
  }
}

/** 사용자 세션으로만 보낸다. 로그인 주체가 없으면 명령을 만들지 않는다. 실패해도 정규 출결은 되돌리지 않는다. */
export async function sendParticipation(effectKey: string, payload: Record<string, unknown>): Promise<ParticipationSend> {
  const db = await createClient();
  const actorId = await authenticatedActorId(db);
  const commandId = actorId ? participationCommandId(effectKey, payload, actorId) : null;
  if (!commandId) return { ok: false, error: "보강 참여를 저장하지 못했습니다" };
  const { data, error } = await db.rpc("makeup_command", {
    p_command_id: commandId, p_action: "participation",
    p_payload: payload, p_expected_revision: null,
  });
  if (error || isMissingMakeupRpc(error)) return { ok: false, error: "보강 참여를 저장하지 못했습니다" };
  const parsed = parseCommandSuccess(data);
  return parsed.ok
    ? {
      ok: true, replayed: parsed.value.replayed, projectionState: parsed.value.projection_state,
      verificationCode: parsed.value.verification_code, verificationOk: parsed.value.verification_ok,
    }
    : { ok: false, error: parsed.error };
}

async function readSqlProjection(effectKey: string): Promise<SqlProjection> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("makeup_projection_evidence", { p_effect_key: effectKey });
    if (error || isMissingMakeupRpc(error)) return parseSqlProjection(null);
    return parseSqlProjection(data);
  } catch {
    return parseSqlProjection(null);
  }
}

function retryResult(
  input: { effectKey: string; participantId: string },
  state: ProjectionRetryResult["state"],
  commandAccepted: boolean,
  evidence: ProjectionEvidence,
  error: string | null,
): ProjectionRetryResult {
  return {
    effectKey: input.effectKey, state, commandAccepted, evidence, error,
    retry: { action: "participation", effectKey: input.effectKey, participantId: input.participantId },
  };
}

/** 재시도는 같은 참여 명령이다. 완료는 증거 RPC가 done·ok·필수 칸을 모두 줄 때만. 시수는 쓰지 않는다. */
export async function retryParticipationEffect(input: {
  effectKey: string;
  participantId: string;
  payload: Record<string, unknown>;
}): Promise<ProjectionRetryResult> {
  const before = await readSqlProjection(input.effectKey);
  if (judgeSqlProjection(before).state === "done") return retryResult(input, "done", true, before.evidence, null);
  const sent = await sendParticipation(input.effectKey, input.payload);
  const after = await readSqlProjection(input.effectKey);
  if (judgeSqlProjection(after).state === "done") return retryResult(input, "done", sent.ok, after.evidence, null);
  if (!sent.ok) return retryResult(input, "failed", false, after.evidence, sent.error);
  const judged = judgeSqlProjection(after);
  return retryResult(input, judged.state, true, after.evidence, judged.error);
}
