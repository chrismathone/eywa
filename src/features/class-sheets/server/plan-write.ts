import "server-only";

/**
 * 수업계획 줄의 **쓰기 밑바닥** — 셀 CAS·줄 추가/이동/삭제·내용 복사의 실제 구현 한 벌.
 *
 * 🔑 왜 액션에서 떼어 냈나: 이 표(`class_sheet_plan_lines`)에 들어오는 문이 **둘**이 됐다 —
 *    ① 로그인 영어 시트·자리 출석부(게이트 = `requireEcsClassAccess`)
 *    ② 비로그인 공개 자리 화면 `/seat/jj`(게이트 = 자리 PIN 쿠키 + 그날 그 교시 명단 화이트리스트).
 *    문이 둘이어도 **규칙은 한 벌**이어야 한다(줄 번호·시기·CAS 기대값·복사 후 canonical). 그래서
 *    게이트는 각자 하고, 통과한 뒤에는 전부 이 모듈을 지난다.
 *
 * 🔴 여기엔 **권한 판정이 없다** — 호출부(액션)가 이미 통과시킨 `PlanWriteGrant`만 받는다.
 *    이 모듈을 "use server" 파일로 만들지 말 것(그 순간 게이트 없는 공개 엔드포인트가 된다).
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 세션 클라이언트로는 **에러 없이 0행**([[#104]]) →
 *    admin 클라이언트 + `tenant_id` 명시 필터. 모든 select/update가 tenant_id + class_id + id 3중 조건.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction, logActionAtDoor } from "@/features/audit/server/log";
import { fetchInChunks } from "@/lib/supabase/batch";
import { normalizePlanText, SKILL_AREA_SLUG_RE } from "../lib/plan-codec";
import { planLineFromRow } from "../lib/plan-line";
import { validatePatchBatch, type PatchResult } from "../lib/save-keys";
import { HHMM_RE, YMD_RE } from "../lib/week";
import { carrySummary, type CarryPatch } from "../lib/carry-marks";
import { carrySelfStudyMarks } from "./carry-marks";
// 타입만 받는다(런타임 의존 0) — DTO 소유자는 계속 서버 액션이다(plan-line.ts와 같은 규약).
import type { PlanLineDTO } from "./actions";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 게이트를 통과한 뒤의 쓰기 허가증. **누가 열어 줬는지는 여기 안 담는다** — 밑바닥은 문을 모른다.
 */
export type PlanWriteGrant = {
  tenantId: string;
  classId: string;
  /**
   * 계획 행에 남길 작성자(`updated_by`).
   * 🔵 공개 PIN 경로는 **null** — 로그인 없이 적은 것을 누군가의 이름으로 적지 않는다
   *    (출결 `recorded_by`·JJ 칸 `updated_by`가 PIN일 때 null인 것과 같은 정직함).
   */
  actorId: string | null;
  /**
   * 무기명 문의 이름(감사로그 행위자 자리) — `actorId`가 null인 문(공개 PIN)이 넘긴다(`JJ실 PIN(비로그인)`).
   * 로그인된 기기면 그 계정이 이긴다(`logActionAtDoor`).
   */
  doorName?: string;
};

/**
 * 이 쓰기가 손댈 수 있는 **칸의 범위**(날짜·교시). 게이트가 날짜·교시까지 좁히는 문
 * (공개 자리 PIN — "오늘, 그 교시")이 넘긴다. 넘기지 않으면 반 단위(로그인 ECS 게이트와 같은 범위).
 *
 * 🔴 **없으면 게이트가 거짓말이 된다**: 줄 id는 반에만 묶여 있어서, 범위를 안 주면 "오늘만"으로 통과한
 *    사람이 그 반의 **지난 날짜 계획 줄**을 (id만 알면) 고치거나 지울 수 있다 — 화면만 잠그고 액션은
 *    열어 둔 꼴(#77). 줄을 새로 만들거나 복사하는 쪽은 날짜·교시를 인자로 직접 받아 이미 좁혀져 있다.
 */
export type PlanWriteScope = { planDate: string; slotStart: string };

export type PlanWriteError = { ok: false; error: string };
export type PlanLinesResult = { ok: true; lines: PlanLineDTO[] } | PlanWriteError;
export type PlanPatchesResult = { ok: true; results: PatchResult[] } | PlanWriteError;

export type PlanCopyResult =
  | {
      ok: true;
      copied: number;
      /** 원본 날짜 "MM-DD"(같은 교시라 시각은 대상과 동일 — 라벨에 안 싣는다) */
      sourceLabel: string | null;
      /** 20줄 상한에 걸려 못 넣은 원본 줄 수(0209a 이전 함수는 안 돌려줘 0) */
      truncated: number;
      reason: string | null;
      /**
       * 이번 복사가 **같은 요일만** 원본으로 봤나(0245a). 실수업=true · 자리(LAB·JJ)=false.
       * 🔴 0245a 미적용이면 `null` — 그때 안내 문구는 옛 규칙(요일 무관) 그대로여야 한다.
       */
      sameDow: boolean | null;
      lines: PlanLineDTO[];
      /** JJ 폼 이어받기(듣기 레벨·누적 암기 단어수) — 호출부가 화면 상태에 머지한다. */
      carried: CarryPatch[];
      /** 이어받기 요약 문구("듣기 레벨 4명 · 누적 암기 단어수 2명") — 빈 문자열이면 채운 게 없다. */
      carrySummary: string;
      /** 0206a 미적용이라 두 칸을 못 채웠다(계획 복사는 그대로 성공). */
      carryPending: boolean;
      /** 이어받기만 실패한 사유(한글) — 계획 복사는 성공이므로 에러로 만들지 않는다. */
      carryError: string | null;
    }
  | PlanWriteError;

const toLineDTO = planLineFromRow;

const KO_DOW = ["일", "월", "화", "수", "목", "금", "토"] as const;
/** "YYYY-MM-DD" → "목". ⚠️ `getUTCDay`여야 한다 — 로컬 파싱이면 서버 타임존에 따라 하루 밀린다. */
function koDowOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "?" : (KO_DOW[d.getUTCDay()] ?? "?");
}

// ── 감사로그 ────────────────────────────────────────────────────────────────

/**
 * 계획 줄의 **구조 변경**만 감사로그에 남긴다(줄 추가·시기/순서 이동·삭제·이전 회차 복사).
 *
 * 🔴 **셀 값 저장(`applyPlanPatches`)은 일부러 안 남긴다** — 그쪽은 타이핑 디바운스로 칸마다 들어오는
 *    저장이라, 한 줄씩 남기면 한 사람의 한 교시 입력이 감사로그를 수백 줄로 덮어 정작 "누가 지웠나"
 *    같은 줄이 묻힌다(회의 메모장 저장을 뺀 것과 같은 판단, log.ts 주석 참조).
 * 🔴 **공개 PIN 경로(`/seat/jj`, `actorId` null)도 남긴다**(2026-09-10 — 종전엔 `logAction`이 비로그인이면
 *    조용히 no-op이었다). `logActionAtDoor`가 로그인된 기기면 그 계정, 아니면 문 이름(`grant.doorName`)으로 적는다.
 *    계정 없는 사람을 누군가의 이름으로 지어내지 않는 것은 그대로다(`actor_id` null).
 *    `viaPin`은 "행에는 작성자를 안 남기는 문으로 들어왔다"는 표시다(감사 actor와 행 작성자가 갈리는 이유).
 */
async function logPlanChange(
  action: string,
  grant: PlanWriteGrant,
  detail: Record<string, unknown>,
): Promise<void> {
  const args = {
    action,
    targetType: "class_sheet_plan",
    // targetLabel은 비운다 — 뷰어가 metadata.classId를 반 이름으로 풀어 '대상' 열에 보여준다(조회 0회).
    metadata: { classId: grant.classId, ...detail, ...(grant.actorId ? {} : { viaPin: true }) },
  };
  if (grant.actorId) await logAction(args);
  else await logActionAtDoor({ tenantId: grant.tenantId, doorName: grant.doorName ?? "자리 PIN(비로그인)" }, args);
}

// ── 필드 CAS 배치 저장 ────────────────────────────────────────────────────────

/**
 * 계획 행 필드 patch 배치 — 필드 단위 CAS(`<field> is not distinct from expected`일 때만 갱신).
 * · 배치에 **다른 반 행이 섞이면 전체 거부**(mixed-class 금지) — lineId 소속을 서버에서 조회해 검증.
 * · 0행 갱신 시: 행 없음=gone / 서버값==newValue=already_applied(응답 유실 재전송) / 그 외=conflict+서버값.
 * · 값은 normalizePlanText(trim, ""→NULL) codec을 서버에서도 강제(클라와 동일 정의).
 */
export async function applyPlanPatches(
  grant: PlanWriteGrant,
  rawPatches: unknown,
  scope?: PlanWriteScope,
): Promise<PlanPatchesResult> {
  const parsed = validatePatchBatch(rawPatches);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const patches = parsed.patches;
  const { tenantId, classId, actorId } = grant;
  const admin = createAdminClient();

  // 배치의 모든 행이 게이트한 반 소속인지 — 하나라도 아니면 전체 거부(§A). 대량 .in은 청크(B3).
  const lineIds = [...new Set(patches.map((p) => p.lineId))];
  let ownRows: PlanRowKey[];
  try {
    ownRows = await fetchInChunks<PlanRowKey>(lineIds, (chunk) =>
      admin
        .from("class_sheet_plan_lines")
        .select("id, class_id, plan_date, slot_start")
        .eq("tenant_id", tenantId)
        .in("id", chunk),
    );
  } catch (e) {
    return { ok: false, error: `저장 준비에 실패했습니다: ${e instanceof Error ? e.message : String(e)}` };
  }
  const foundIds = new Set(ownRows.map((r) => r.id));
  if (ownRows.some((r) => r.class_id !== classId)) {
    return { ok: false, error: "다른 반의 행이 섞여 있어 저장을 거부했습니다" };
  }
  // 범위가 있으면 그 날짜·교시 밖 줄이 하나라도 섞이면 **전체 거부**(mixed-class와 같은 결).
  if (scope && ownRows.some((r) => !inScope(r, scope))) {
    return { ok: false, error: "다른 날짜·교시의 행이 섞여 있어 저장을 거부했습니다" };
  }

  const results: PatchResult[] = [];
  for (const p of patches) {
    if (!foundIds.has(p.lineId)) {
      results.push({ saveKey: p.saveKey, status: "gone", clientRev: p.clientRev });
      continue;
    }
    const expected = normalizePlanText(p.expectedValue);
    const newValue = normalizePlanText(p.newValue);
    if (p.field === "skill_area" && (newValue === null || !SKILL_AREA_SLUG_RE.test(newValue))) {
      results.push({ saveKey: p.saveKey, status: "error", clientRev: p.clientRev, error: "영역 값이 올바르지 않습니다" });
      continue;
    }
    let update = admin
      .from("class_sheet_plan_lines")
      .update({ [p.field]: newValue, updated_by: actorId })
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("id", p.lineId);
    update = expected === null ? update.is(p.field, null) : update.eq(p.field, expected);
    const { data: updated, error: upErr } = await update.select("id");
    if (upErr) {
      results.push({ saveKey: p.saveKey, status: "error", clientRev: p.clientRev, error: explainDbError(upErr, { scope: "class-sheets.plan-write.applyPlanPatches", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message });
      continue;
    }
    if ((updated ?? []).length > 0) {
      results.push({ saveKey: p.saveKey, status: "applied", clientRev: p.clientRev });
      continue;
    }
    // 0행 — 현재값 조회로 3분기
    const { data: cur } = await admin
      .from("class_sheet_plan_lines")
      .select(p.field)
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("id", p.lineId)
      .maybeSingle();
    if (!cur) {
      results.push({ saveKey: p.saveKey, status: "gone", clientRev: p.clientRev });
      continue;
    }
    const serverValue = normalizePlanText((cur as Record<string, string | null>)[p.field]);
    if (serverValue === newValue) {
      results.push({ saveKey: p.saveKey, status: "already_applied", clientRev: p.clientRev });
    } else {
      results.push({ saveKey: p.saveKey, status: "conflict", clientRev: p.clientRev, serverValue });
    }
  }
  return { ok: true, results };
}

// ── 구조 변경(RPC 위임) ──────────────────────────────────────────────────────

async function rpcSlotLines(rpc: string, args: Record<string, unknown>): Promise<PlanLinesResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(rpc, args);
  if (error) {
    if (error.message.includes("ECS_MAX_LINES")) return { ok: false, error: "한 교시에 담을 수 있는 줄 수(20)를 넘었습니다" };
    return { ok: false, error: explainDbError(error, { scope: "class-sheets.plan-write.rpcSlotLines", fallback: "저장에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }
  return { ok: true, lines: ((data ?? []) as Record<string, unknown>[]).map(toLineDTO) };
}

export async function insertPlanLine(
  grant: PlanWriteGrant,
  input: { planDate: string; slotStart: string; termMode: "regular" | "exam"; skillArea: string },
): Promise<PlanLinesResult> {
  if (!YMD_RE.test(input.planDate) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/시각)" };
  }
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  if (!SKILL_AREA_SLUG_RE.test(input.skillArea)) return { ok: false, error: "잘못된 요청입니다(영역)" };
  const res = await rpcSlotLines("ecs_create_plan_line", {
    p_tenant: grant.tenantId,
    p_actor: grant.actorId,
    p_class: grant.classId,
    p_plan_date: input.planDate,
    p_slot_start: input.slotStart,
    p_term_mode: input.termMode,
    p_skill_area: input.skillArea,
  });
  if (res.ok) {
    await logPlanChange("ecs_plan_line_add", grant, {
      planDate: input.planDate,
      slotStart: input.slotStart,
      termMode: input.termMode,
      skillArea: input.skillArea,
    });
  }
  return res;
}

type PlanRowKey = { id: string; class_id: string; plan_date: string; slot_start: string };

/**
 * 그 줄이 범위(날짜·교시) 안인가.
 * ⚠️ 교시는 JS에서 비교한다 — DB는 `time`("HH:MM:SS")이라 문자열 eq가 표기 차이에 걸린다(jj-plan과 같은 규약).
 */
function inScope(row: PlanRowKey, scope: PlanWriteScope): boolean {
  return String(row.plan_date).slice(0, 10) === scope.planDate && hhmmOf(row.slot_start) === hhmmOf(scope.slotStart);
}

function hhmmOf(time: string): string {
  return (time ?? "").slice(0, 5);
}

/**
 * 이동/삭제 대상 행이 게이트한 반(그리고 범위가 있으면 그 날짜·교시) 소속인지 확인
 * (§A — 실제 행의 class를 서버에서 조회 후 대조).
 */
async function assertLineInClass(
  tenantId: string,
  classId: string,
  lineId: string,
  scope?: PlanWriteScope,
): Promise<{ ok: true; row: PlanRowKey } | { ok: false; code: "gone" | "foreign"; error: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_sheet_plan_lines")
    .select("id, class_id, plan_date, slot_start")
    .eq("tenant_id", tenantId)
    .eq("id", lineId)
    .maybeSingle();
  if (!data) return { ok: false, code: "gone", error: "행을 찾을 수 없습니다(다른 사용자가 삭제했을 수 있음)" };
  if (data.class_id !== classId) return { ok: false, code: "foreign", error: "다른 반의 행입니다" };
  // 🔴 범위 밖은 **없는 줄이 아니라 남의 줄**로 다룬다 — gone으로 돌리면 삭제가 멱등 성공으로 위장한다.
  if (scope && !inScope(data as PlanRowKey, scope)) {
    return { ok: false, code: "foreign", error: "이 교시의 행이 아닙니다" };
  }
  // 행을 함께 돌려준다 — 삭제 감사로그가 "어느 날 어느 교시 줄이 사라졌나"를 조회 없이 남기도록
  // (지운 뒤에는 그 사실을 되물을 곳이 없다).
  return { ok: true, row: data as PlanRowKey };
}

export async function relocatePlanLine(
  grant: PlanWriteGrant,
  input: { lineId: string; termMode: "regular" | "exam"; lineNo: number },
  scope?: PlanWriteScope,
): Promise<PlanLinesResult> {
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  const own = await assertLineInClass(grant.tenantId, grant.classId, input.lineId, scope);
  if (!own.ok) return { ok: false, error: own.error };
  const lineNo = Math.max(1, Math.min(20, Math.round(input.lineNo)));
  const res = await rpcSlotLines("ecs_move_plan_line", {
    p_tenant: grant.tenantId,
    p_actor: grant.actorId,
    p_line_id: input.lineId,
    p_term_mode: input.termMode,
    p_line_no: lineNo,
  });
  if (res.ok) {
    await logPlanChange("ecs_plan_line_move", grant, {
      lineId: input.lineId,
      termMode: input.termMode,
      lineNo,
    });
  }
  return res;
}

export async function removePlanLine(
  grant: PlanWriteGrant,
  input: { lineId: string },
  scope?: PlanWriteScope,
): Promise<PlanLinesResult> {
  const own = await assertLineInClass(grant.tenantId, grant.classId, input.lineId, scope);
  if (!own.ok) {
    // 이미 삭제된 행(gone)이면 멱등 성공으로 취급(클라 재조회 유도) — 다른 반(foreign)만 하드 거부
    if (own.code === "foreign") return { ok: false, error: own.error };
    return { ok: true, lines: [] };
  }
  const res = await rpcSlotLines("ecs_delete_plan_line", {
    p_tenant: grant.tenantId,
    p_line_id: input.lineId,
  });
  // 🔴 위 멱등 성공(이미 지워진 행)은 여기 안 온다 — 실제로 지운 것만 남긴다.
  if (res.ok) {
    await logPlanChange("ecs_plan_line_delete", grant, {
      lineId: input.lineId,
      planDate: String(own.row.plan_date).slice(0, 10),
      slotStart: hhmmOf(own.row.slot_start),
    });
  }
  return res;
}

/**
 * 내용 복사(`ecs_copy_slot`) — 원본은 **같은 교시(slot_start)의 지난 수업일**, 동작은 **빈 칸만 채우기**.
 *
 * 0183a는 "이 교시보다 앞선 것 중 가장 최근"이라 하루에 여러 교시를 하는 반에서 **같은 날 앞 교시**가
 * 원본으로 잡혔는데, 교시마다 교재가 달라(3교시 Vocab·4교시 Reading…) 엉뚱한 내용이 들어왔다. 0209a가
 * 원본을 같은 교시로 고정하고, 덮어쓰기 대신 **비어 있는 칸만** 채우게 바꿨다(원장 2026-08-14).
 * 학생 기록은 여전히 안 옮긴다.
 *
 * 🔵 **공개 PIN 화면도 이 버튼을 쓴다**(원장 승인 2026-08-25) — 그래서 이 경로만 **오늘 명단 밖의 지난
 *    기록**을 읽는다. 범위를 넓히는 인자는 없다: RPC가 `p_class` + `p_slot_start`로 잠가 **같은 반·같은
 *    교시**의 지난 수업일만 원본으로 삼는다(다른 반·다른 교시는 애초에 후보가 아니다).
 *
 * ⚠️ 마이그레이션이 아직 안 돌았으면 PostgREST가 "함수를 못 찾겠다"로 떨어진다([[#95]]). 그때도 **화면은
 *    안 죽고** 이 액션만 실패해야 하므로(호출부는 토스트) 사유를 한글로 바꿔서 돌려준다.
 *    0209a는 **시그니처를 안 바꿨다** — 적용 전이면 옛 동작(직전 교시·덮어쓰기 없음)으로 그냥 돌아간다.
 */
export async function copyPlanSlotFromPrevious(
  grant: PlanWriteGrant,
  input: { planDate: string; slotStart: string; termMode: "regular" | "exam" },
): Promise<PlanCopyResult> {
  if (!YMD_RE.test(input.planDate) || !HHMM_RE.test(input.slotStart)) {
    return { ok: false, error: "잘못된 요청입니다(날짜/시각)" };
  }
  if (input.termMode !== "regular" && input.termMode !== "exam") {
    return { ok: false, error: "잘못된 요청입니다(시기)" };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ecs_copy_slot", {
    p_tenant: grant.tenantId,
    p_actor: grant.actorId,
    p_class: grant.classId,
    p_plan_date: input.planDate,
    p_slot_start: input.slotStart,
    p_term_mode: input.termMode,
  });
  if (error) {
    // 스키마 미적용(배포가 SQL보다 앞선 구간) — raw 원문 대신 사람이 읽을 수 있는 안내로.
    if (/could not find|does not exist|schema cache/i.test(error.message)) {
      return { ok: false, error: "이 기능은 아직 준비 중입니다(DB 반영 대기)" };
    }
    return { ok: false, error: explainDbError(error, { scope: "class-sheets.plan-write.copyPlanSlotFromPrevious", fallback: "내용 복사에 실패했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }
  const r = (data ?? {}) as {
    copied?: number;
    truncated?: number;
    reason?: string;
    sourceDate?: string;
    sourceSlot?: string;
    sameDow?: boolean;
    lines?: Record<string, unknown>[];
  };
  // JJ 폼 이어받기 — 같은 버튼이 학생별 듣기 레벨·누적 암기 단어수까지 채운다(직원 요청 2026-08-19).
  // ⚠️ 계획 복사가 아무것도 못 했어도 **따로** 돈다 — 두 칸의 원본은 계획 줄이 아니라 학생 기록이라
  //    "지난 계획이 없다"가 "지난 레벨이 없다"를 뜻하지 않는다. JJ 교시가 아니면 그 안에서 곧장 접힌다.
  const carry = await carrySelfStudyMarks({
    admin,
    tenantId: grant.tenantId,
    classId: grant.classId,
    actorId: grant.actorId,
    planDate: input.planDate,
    slotStart: input.slotStart,
  });

  // 한 번 누름 = 여러 줄이 한꺼번에 채워지는 구조 변경이라 **한 줄로 요약**한다(줄마다 남기지 않는다).
  // ⚠️ 이어받기(carry)는 계획 복사가 0줄이어도 학생 칸을 채운다 — 둘 중 하나라도 바뀌었으면 남긴다.
  if ((r.copied ?? 0) > 0 || carry.patches.length > 0) {
    await logPlanChange("ecs_plan_copy", grant, {
      planDate: input.planDate,
      slotStart: input.slotStart,
      termMode: input.termMode,
      copied: r.copied ?? 0,
      sourceDate: r.sourceDate ?? null,
      carried: carry.patches.length,
    });
  }

  return {
    ok: true,
    copied: r.copied ?? 0,
    // 같은 교시에서만 가져오므로 시각은 대상과 늘 같다 — 라벨엔 **날짜만**(붙이면 "08-11 19:20 교시"가
    // 되어 마치 다른 시각에서 온 것처럼 읽힌다). ⚠️ 0209a 적용 전 함수는 다른 시각을 돌려줄 수 있다.
    // 🔑 요일을 함께 적는다(0245a) — 원본을 같은 요일로 좁힌 뒤로는 요일이 곧 "어느 수업에서 왔나"다.
    sourceLabel: r.sourceDate ? `${r.sourceDate.slice(5)}(${koDowOf(r.sourceDate)})` : null,
    truncated: r.truncated ?? 0,
    sameDow: typeof r.sameDow === "boolean" ? r.sameDow : null,
    reason: r.reason ?? null,
    lines: (r.lines ?? []).map(toLineDTO),
    carried: carry.patches,
    carrySummary: carrySummary(carry.patches),
    carryPending: carry.pending,
    carryError: carry.error,
  };
}
