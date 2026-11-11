"use server";

// 운영 과목 삭제 = "다른 과목에 흡수" — 그 과목 키를 참조하는 전 데이터를 대상 과목 키로 옮긴 뒤
// 설정에서 과목 행 제거(설정 쓰기는 saveOwnerSection 경유 = 단일 쓰기 경로·zod·감사·캐시 무효화 재사용).
//
// ⚠️ 과목 키 저장 표면 전수(2026-07-06 스키마, 적대리뷰 열거 검증 통과) — 하나라도 빠지면 raw 키
// 잔존(orphan, CLAUDE.md highmath 마이그레이션 교훈). 새 subject 컬럼/jsonb를 추가하면 여기에도 추가:
//   스칼라 9: classes·enrollment_consultations·student_consultations·student_grades·exams·
//             level_tests·grade_goals·grade_comments·textbook_catalog        (아래 SCALAR_TABLES)
//   배열 1:   users.subjects[] (강사 담당 과목)                               (RPC absorb_subject_key)
//   jsonb 2:  enrollment_consultations.subject_details · onescreen_daily_sessions.subject_progress (RPC)
//   설정 1:   tenant_settings.data.operations.subjects (행 제거)
//   옮기지 않고 **막는** 표 3: 신규생 관리(과목별 완료 체크 0256a · 과목별 담당 배정 · 적응 피드백 — s2_0061·s2_0062). 옮기는 규칙이 없는 관리 기록이라
//             기록이 있는 과목은 흡수·삭제를 거절한다(countNewcomerSubjectRecords · 사용 현황에도 센다 · 과목 행을 지우는 마지막 저장도 다시 본다 — actions.ts).
//   옮기지 않는 설정 1: permissions.specialAccess.staffSubjectScopes(직원관리 과목 범위) — 역할·권한은 원장만 저장하는 섹션이라
//             여기서 대신 고치지 않는다. 없어진 키는 아무와도 안 맞아 **좁은 쪽**으로 남고, 역할·권한 면이 '(없어진 과목)'으로 보여 준다.
// 의도적 제외: consultation_ai_analysis.print_payload 등 동결 스냅샷(불변 설계) · tuition_catalog.category(라벨 분류, 키 아님).
//
// users/jsonb 이동은 0077a RPC(absorb_subject_key, security invoker + auth_tenant_id 이중격리)로
// **DB에서 원자 실행** — 클라 read-then-overwrite 루프의 동시저장(원스크린 800ms 자동저장) 유실 레이스와
// 행당 왕복 누적으로 인한 서버리스 타임아웃을 제거(적대리뷰 확정 2건).
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { countPeriodsForSubject, moveSubjectPeriods } from "@/features/periods/server/queries";
import { countNewcomerSubjectRecords } from "@/features/newcomers/server/subject-refs";
import { resolveSettings } from "../resolve";
import { isValidSubjectKey } from "../subject-absorb";
import { cleanPreset, sanitizeGroups, sanitizeTeacherOrder } from "../subject-fields";
import type { IntegrationGroupPresetSetting, OperationsSettings } from "../settings-types";
import { saveOwnerSection } from "./actions";
import { explainDbError, logDbError } from "@/lib/supabase/db-error";
import { MENU_LABEL } from "@/lib/permissions";

/** 조회 실패의 화면 문구 — 표 이름·DB 원문은 화면으로 올리지 않고 로그에만 남긴다. */
const USAGE_READ_FAILED = "과목 사용 현황을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
/** 조회 단계에서 던져진 오류 → 화면 문구. 원문은 여기서 로그로 남기고 문구는 하나로 답한다. */
function readFailureMessage(error: unknown, scope: string): string {
  console.error(`[owner/subject-actions] ${scope} 실패`, error);
  return USAGE_READ_FAILED;
}

const SCALAR_TABLES = [
  { table: "classes", label: "반" },
  { table: "enrollment_consultations", label: "신규 콜&상담" },
  { table: "student_consultations", label: "학생상담" },
  { table: "student_grades", label: "성적" },
  { table: "exams", label: "시험" },
  { table: "level_tests", label: "레벨테스트" },
  { table: "grade_goals", label: "성적 목표" },
  { table: "grade_comments", label: "학습 코멘트" },
  { table: "textbook_catalog", label: "교재 단가표" },
] as const;

export type SubjectUsage = {
  total: number;
  items: { label: string; count: number }[];
  /** 흡수도 삭제도 못 하는 까닭(있을 때만) — 옮기는 규칙이 없는 기록(신규생 관리)이 이 과목에 걸려 있다. 삭제 창이 흡수 버튼 대신 이 문구를 보인다. */
  blocked?: string;
};

/** 신규생 관리 기록이 걸린 과목의 안내 — 삭제 창 · 미사용 삭제 · 흡수가 같은 문구를 쓴다. */
const newcomerBlocked = (count: number) =>
  `이 과목에 신규생 관리 기록(완료 체크·담당 배정·적응 피드백)이 ${count}건 있어 다른 과목에 흡수하거나 지울 수 없습니다. 이 기록은 과목별 관리 이력이라 옮기지 않습니다.`;

type OwnerWriteGate =
  | { error: string; actor?: undefined }
  | { error?: undefined; actor: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> };

// 과목 운영 탭 = owner 콘솔 소속 → 게이트도 owner 메뉴 쓰기(override 반영, #58) — 원장이 위임하면 열림.
// (내부의 설정 행 제거는 saveOwnerSection(operations) 경유라 동일 게이트로 정합.)
async function requireOwnerWrite(): Promise<OwnerWriteGate> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "operations_settings"))) {
    return { error: `${MENU_LABEL.operations_settings} 변경 권한이 없습니다` };
  }
  return { actor };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 사용량 집계 코어 — 다이얼로그 표시와 removeUnusedSubject 실행 시점 재검증이 공유. count head:true(B2). */
async function countSubjectUsage(supabase: Supabase, tenantId: string, key: string): Promise<SubjectUsage> {
  const scalarCounts = Promise.all(
    SCALAR_TABLES.map(async ({ table, label }) => {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("subject", key);
      // 표 이름·DB 원문을 화면으로 올리지 않는다 — 원문은 로그에만(호출부가 안내 문구로 바꾼다).
      if (error) {
        logDbError(error, "owner.subjectUsage", { table });
        throw new Error(USAGE_READ_FAILED);
      }
      return { label, count: count ?? 0 };
    }),
  );
  const teacherCount = supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .contains("subjects", [key]);
  const detailsCount = supabase
    .from("enrollment_consultations")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .not(`subject_details->${key}`, "is", null);
  const onescreenCount = supabase
    .from("onescreen_daily_sessions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .not(`subject_progress->${key}`, "is", null);

  // 세션 기간(operating_periods)은 컬럼명이 subject_key라 SCALAR_TABLES에 못 넣고,
  // RLS 정책 0개(service_role 전용)라 이 supabase로는 0행으로 보인다 → admin 헬퍼로 따로 센다.
  const periodCount = countPeriodsForSubject(tenantId, key);

  const [scalars, tc, dc, oc, pc, nc] = await Promise.all([
    scalarCounts,
    teacherCount,
    detailsCount,
    onescreenCount,
    periodCount,
    countNewcomerSubjectRecords(tenantId, key),
  ]);
  if (nc === null) throw new Error(USAGE_READ_FAILED);
  for (const [table, res] of [["users", tc], ["subject_details", dc], ["subject_progress", oc]] as const) {
    if (res.error) {
      logDbError(res.error, "owner.subjectUsage", { table });
      throw new Error(USAGE_READ_FAILED);
    }
  }
  const items = [
    ...scalars,
    { label: "담당 강사", count: tc.count ?? 0 },
    { label: "상담 과목별 점수", count: dc.count ?? 0 },
    { label: "원스크린 세션", count: oc.count ?? 0 },
    { label: "세션 기간", count: pc },
    { label: "신규생 관리 기록", count: nc },
  ].filter((i) => i.count > 0);
  return { total: items.reduce((a, b) => a + b.count, 0), items, ...(nc > 0 ? { blocked: newcomerBlocked(nc) } : {}) };
}

/** 과목 키를 참조하는 데이터 건수(표면별) — 삭제 다이얼로그 표시용. */
export async function getSubjectUsage(key: string): Promise<SubjectUsage | { error: string }> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(key)) return { error: "잘못된 과목 키입니다" };
  try {
    return await countSubjectUsage(await createClient(), gate.actor.tenantId, key);
  } catch (e) {
    return { error: readFailureMessage(e, "과목 사용량 조회") };
  }
}

/** DB에서 설정을 fresh로 읽어 해석(React cache/unstable_cache 우회) — read-modify-write 창 최소화. */
async function readFreshOperations(supabase: Supabase, tenantId: string) {
  const { data: existing, error } = await supabase
    .from("tenant_settings")
    .select("data")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    logDbError(error, "owner.readFreshOperations");
    throw new Error(USAGE_READ_FAILED);
  }
  // resolveSettings는 순수(profile.name 폴백만 tenant명 사용 — operations에 무관).
  return resolveSettings(existing?.data ?? null, { name: "" }).operations;
}

/**
 * 운영 섹션의 **제 몫만** 저장한다 — saveOwnerSection 경유(단일 쓰기 경로).
 * 🔴 운영 섹션 전체를 읽어서 되돌려 보내지 않는다 — 읽은 뒤 저장되기 전에 다른 곳이 바꾼 값을 되돌리게 된다.
 *    요청은 "무엇을 바꾸는지"만 싣고, 적용은 저장 액션이 방금 읽은 값 위에서 한다(operations-slice.ts).
 */
async function saveOperationsIntent(intent: "subject-fields" | "subject-remove", data: unknown) {
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("operationsFace", intent);
  fd.set("data", JSON.stringify(data));
  return saveOwnerSection(undefined, fd);
}

/** 과목 삭제가 확정한 과목 운영 면의 값과 그 값의 기준 token — 화면은 **둘을 함께** 채택한다. */
export type SubjectsFaceResult = {
  snapshot: Pick<OperationsSettings, "subjects" | "weekdayGroupings" | "hiddenBuiltinWeekdayGroupings">;
  token: string;
  /** 이 상태를 쓴 저장의 순번 — 화면이 이보다 먼저 읽힌 값을 받지 않는다. */
  version: number | undefined;
};

/** 설정 subjects에서 key 행 제거. 행이 이미 없어도 지금 확정 상태를 돌려준다. */
async function removeSubjectRowFromSettings(key: string): Promise<{ error: string } | { subjectsFace?: SubjectsFaceResult }> {
  const res = await saveOperationsIntent("subject-remove", { key });
  if (res?.error) return { error: res.error };
  const reply = res?.operations;
  return {
    subjectsFace: reply?.subjectsFace
      ? { snapshot: reply.subjectsFace, token: reply.tokens.subjects, version: res?.version }
      : undefined,
  };
}

export type AbsorbResult = {
  ok?: boolean;
  moved?: number;
  error?: string;
  /**
   * 삭제 뒤의 과목 운영 면 확정 상태. 🔴 화면은 자기 목록에서 행만 빼지 말고 이 값을 통째로 받는다 —
   * 화면이 깨끗해 보여도 그사이 다른 창이 다른 과목을 고쳤을 수 있고, 옛 목록에 새 token을 붙이면 그 변경을 되돌린다.
   */
  subjectsFace?: SubjectsFaceResult;
};

/**
 * 보관함 저장 결과 — **서버가 찍은 '누가·언제'를 그대로 돌려준다.**
 * 🔴 안 돌려주면 화면이 방금 저장한 항목을 "저장자 미상 · 시각 없음"으로 그린다(클라엔 도장이 없다).
 *    새로고침해야 보이는 값은 없는 값이나 마찬가지다.
 */
export type IntegrationGroupsResult = AbsorbResult & {
  presets?: IntegrationGroupPresetSetting[];
};

/**
 * 과목 흡수 실행: from 키의 전 데이터 → to 키로 이동 후, 설정에서 from 과목 행 제거.
 * 즉시 적용(폼 저장 버튼과 무관). 실패해도 재실행 멱등(이미 옮겨진 행은 조건 불일치로 무시).
 * DB 이동 → 설정 제거 순서 — 중간 실패 시 과목은 설정에 남아(사용량 0으로 재시도/일반 삭제 가능).
 */
export async function absorbSubject(input: { from: string; to: string }): Promise<AbsorbResult> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  const { actor } = gate;
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  if (!isValidSubjectKey(from) || !isValidSubjectKey(to)) return { error: "잘못된 과목 키입니다" };
  if (from === to) return { error: "같은 과목으로는 흡수할 수 없습니다" };

  const t = actor.tenantId;
  const supabase = await createClient();
  const operations = await readFreshOperations(supabase, t);
  const toRow = operations.subjects.find((s) => s.key === to);
  if (!toRow) return { error: "흡수 대상 과목이 설정에 없습니다" };
  const fromLabel = operations.subjects.find((s) => s.key === from)?.label || from;

  // 0-0) 신규생 관리 기록(과목별 완료 체크·담당 배정·적응 피드백)은 흡수가 옮기지 않는다 — 데이터를 옮기기 **전에** 멈춘다(옛 키에 기록만 남지 않게).
  //      마지막에 과목 행을 지우는 저장도 같은 확인을 한 번 더 한다(그사이 들어온 기록 · 다른 경로의 과목 삭제).
  const newcomerRecords = await countNewcomerSubjectRecords(t, from);
  if (newcomerRecords === null) return { error: USAGE_READ_FAILED };
  if (newcomerRecords > 0) {
    return { error: `'${fromLabel}' — ${newcomerBlocked(newcomerRecords)}` };
  }

  // 0) classes 유니크 (tenant, class_name, subject) 충돌 사전 점검 — 같은 반 이름이 양쪽 과목에
  //    있으면 UPDATE가 통째로 실패하므로 먼저 친절하게 알린다(fetchAllPaged = 1000행 절단 회피 B2).
  //    점검~UPDATE 사이 레이스는 아래 23505 매핑이 백스톱.
  try {
    const [fromNames, toNames] = await Promise.all([
      fetchAllPaged<{ class_name: string }>((lo, hi) =>
        supabase.from("classes").select("class_name").eq("tenant_id", t).eq("subject", from).order("id").range(lo, hi),
      ),
      fetchAllPaged<{ class_name: string }>((lo, hi) =>
        supabase.from("classes").select("class_name").eq("tenant_id", t).eq("subject", to).order("id").range(lo, hi),
      ),
    ]);
    const toSet = new Set(toNames.map((r) => r.class_name));
    const collide = [...new Set(fromNames.map((r) => r.class_name))].filter((n) => toSet.has(n));
    if (collide.length > 0) {
      return {
        error: `반 이름이 양쪽 과목에 모두 있어 흡수할 수 없습니다: ${collide.slice(0, 5).join(", ")}${collide.length > 5 ? ` 외 ${collide.length - 5}개` : ""} — 반 이름을 먼저 바꿔 주세요.`,
      };
    }
  } catch (e) {
    return { error: readFailureMessage(e, "반 이름 충돌 점검") };
  }

  let moved = 0;
  const detail: Record<string, number> = {};
  /** 이 요청이 쓰기를 한 번이라도 끝냈는가 — 그 뒤의 실패는 "앞의 것은 이미 옮겨졌을 수 있다"고 알려야 한다. */
  let wrote = false;
  /**
   * 쓰기 실패의 화면 문구 — 표 이름·DB 원문 대신 한글 사유(원문은 로그에).
   * 앞 쓰기가 이미 끝났거나, DB가 거절했다고 알려 주지 않은 실패(응답을 못 받음)면 일부가 옮겨졌을 수 있다고 알린다.
   * 첫 쓰기를 DB가 거절한 것이면(오류 코드가 있다) 옮겨진 것이 없다 — 그렇게 말한다(적대 리뷰 5b B3).
   */
  const writeFailure = (error: unknown, scope: string, context?: Record<string, unknown>): string => {
    const info = explainDbError(error, { scope, fallback: "과목을 옮기지 못했습니다", context });
    const code = (error as { code?: unknown } | null)?.code;
    const rejected = typeof code === "string" && code.length > 0;
    return wrote || !rejected
      ? `${info.message} — 일부 기록은 이미 옮겨졌을 수 있습니다. 새로고침한 뒤 다시 시도해 주세요.`
      : `${info.message} — 옮겨진 기록은 없습니다.`;
  };

  // 1) 스칼라 subject 컬럼 9테이블 일괄 치환(테이블당 단일 원자 UPDATE)
  for (const { table } of SCALAR_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .update({ subject: to }, { count: "exact" })
      .eq("tenant_id", t)
      .eq("subject", from);
    if (error) {
      // 사전점검~UPDATE 레이스로 유니크 충돌이 뚫린 경우 raw 23505 대신 친절 안내
      if (error.code === "23505") {
        logDbError(error, "owner.absorbSubject");
        return { error: "그 사이 같은 이름의 반이 생겨 흡수할 수 없습니다 — 반 이름을 바꾼 뒤 다시 시도해 주세요." };
      }
      return { error: writeFailure(error, "owner.absorbSubject", { table }) };
    }
    wrote = true;
    if (count) {
      moved += count;
      detail[table] = count;
    }
  }

  // 2) users.subjects[] + jsonb 2곳 — 0077a RPC(원자 단일 문, 현재 행 값 기준)로 일괄 이동
  {
    const { data, error } = await supabase.rpc("absorb_subject_key", { p_from: from, p_to: to });
    if (error) return { error: writeFailure(error, "owner.absorbSubject.rpc") };
    const counts = (data ?? {}) as Record<string, number>;
    for (const [k, n] of Object.entries(counts)) {
      if (typeof n === "number" && n > 0) {
        moved += n;
        detail[k] = n;
      }
    }
  }

  // 2-b) 세션 기간(operating_periods) — RLS 정책 0개라 admin 헬퍼로 옮긴다(0189a).
  // 한 (과목, 연·월)에 세션은 하나뿐이라, 흡수 대상에 같은 달이 이미 있으면 update가 통째로 실패한다
  // → 먼저 충돌을 짚어 사람이 정리하게 한다(설정 행을 지우기 **전에** 멈춰야 되돌릴 수 있다).
  {
    let periods: Awaited<ReturnType<typeof moveSubjectPeriods>>;
    try {
      periods = await moveSubjectPeriods(t, from, to);
    } catch (e) {
      console.error("[owner/subject-actions] 세션 기간 이동 실패", e);
      return { error: "세션 기간을 옮기지 못했습니다 — 일부 기록은 이미 옮겨졌을 수 있습니다. 새로고침한 뒤 다시 시도해 주세요." };
    }
    if ("conflicts" in periods) {
      return {
        error: `흡수 대상 과목에 ${periods.conflicts.join("·")} 세션이 이미 있습니다 — 세션 기간 탭에서 먼저 정리해 주세요.`,
      };
    }
    if (periods.moved > 0) {
      moved += periods.moved;
      detail.operating_periods = periods.moved;
    }
  }

  // 3) 설정에서 from 과목 행 제거 — 저장 액션이 방금 읽은 값에서 그 행만 뺀다(흡수 진행 중 다른 창의 설정 저장분 보존)
  const removed = await removeSubjectRowFromSettings(from);
  if ("error" in removed) {
    return { error: `데이터는 옮겼지만 설정 저장 실패: ${removed.error}` };
  }

  await logAction({
    action: "owner_subject_absorb",
    targetType: "tenant_settings",
    targetLabel: `${fromLabel} → ${toRow.label || to}`,
    metadata: { from, to, moved, detail },
  });

  return { ok: true, moved, subjectsFace: removed.subjectsFace };
}

/**
 * 미사용 과목 삭제 — 실행 시점에 사용량을 **재검증**한 뒤(다이얼로그 오픈 후 생긴 데이터 = TOCTOU 차단)
 * 설정에서 과목 행을 즉시 제거(saveOwnerSection 경유). 사용 데이터가 생겼으면 거부(흡수 삭제 안내).
 */
export async function removeUnusedSubject(key: string): Promise<AbsorbResult> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(key)) return { error: "잘못된 과목 키입니다" };
  const t = gate.actor.tenantId;
  const supabase = await createClient();

  try {
    const usage = await countSubjectUsage(supabase, t, key);
    // 흡수로도 못 옮기는 기록이 있으면 '흡수 삭제'로 보내지 않는다(거기서도 거절된다) — 까닭을 바로 말한다.
    if (usage.blocked) return { error: usage.blocked };
    if (usage.total > 0) {
      return { error: `그 사이 이 과목을 쓰는 데이터가 ${usage.total}건 생겼습니다 — 흡수 삭제를 사용해 주세요.` };
    }
  } catch (e) {
    return { error: readFailureMessage(e, "과목 사용량 재확인") };
  }

  const removed = await removeSubjectRowFromSettings(key);
  if ("error" in removed) return { error: removed.error };

  await logAction({
    action: "owner_subject_delete",
    targetType: "tenant_settings",
    targetLabel: key,
    metadata: { key },
  });

  return { ok: true, moved: 0, subjectsFace: removed.subjectsFace };
}

export type IntegrationGroupsInput = {
  subject: string;
  enabled: boolean;
  groups: { id: string; title: string; classIds: string[] }[];
  showOthers: boolean;
  othersTitle: string;
  /**
   * 보관함(프리셋) 전체. **넘기면 통째로 교체**, 안 넘기면(undefined) 저장된 것을 그대로 둔다 —
   * 프리셋을 안 건드리는 화면이 실수로 보관함을 비우지 않게(부분 갱신 아님을 호출부가 알도록 명시).
   */
  presets?: {
    id: string;
    name: string;
    groups: { id: string; title: string; classIds: string[] }[];
    showOthers?: boolean;
    othersTitle?: string;
    /** ⚠️ 보내도 무시된다 — '누가·언제'는 서버가 찍는다(위조 방지). 타입만 받아 준다(왕복 편의). */
    savedBy?: string;
    savedAt?: string;
  }[];
};

/**
 * 통합뷰 커스텀 그룹 저장(과목별) — 시간표 화면의 '그룹 설정' 창이 부른다.
 *
 * 쓰기 경로는 다른 과목 설정과 **동일**하게 saveOwnerSection(operations) 하나로 모은다: zod 검증·섹션
 * 머지·감사로그·캐시 무효화를 그대로 재사용하고, tenant_settings 직접 쓰기를 만들지 않는다([[#59]]).
 * 게이트도 owner 쓰기 — 시간표 화면에 있다고 시간표 권한으로 열면 학원설정을 우회하는 뒷문이 된다(#77).
 *
 * ⚠️ **그 과목의 시간표 칸만** 보낸다(`subject-fields`) — 적용은 저장 액션이 방금 읽은 값 위에서 한다.
 * 운영 섹션 전체를 읽어 되돌려 보내면 그사이 과목 운영 탭에서 저장한 다른 설정이 날아간다.
 */
/**
 * 강사뷰 **컬럼(강사) 순서** 저장 — 학원설정(과목별). 원장 2026-08-04:
 * *"강사뷰에서 JJ와 LAB은 최우측으로 디폴트값으로 넣고, 강사 순서(LAB/JJ 포함) 설정하는 곳 있으면 좋겠네."*
 *
 * 목록에 없는 강사는 지우지 않는다 — 순서는 **정렬 힌트**일 뿐이고, 안 적힌 사람은 뒤에 붙는다
 * (`buildTeacherComparator`). 그래서 새 강사가 와도 화면에서 사라지지 않는다.
 * 계정이 아니라 학원 설정에 두는 이유: 이건 취향이 아니라 **시트와 맞추는 운영 배치**라 전 직원이 같은
 * 순서를 봐야 한다(통합뷰 그룹 설정과 같은 자리).
 */
export async function saveTeacherViewOrder(input: {
  subject: string;
  order: string[];
}): Promise<AbsorbResult> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(input.subject)) return { error: "잘못된 과목 키입니다" };

  // 빈 값·중복 제거(먼저 나온 것이 이긴다) — 중복이 있으면 정렬 인덱스가 갈려 순서가 흔들린다.
  // (저장 액션도 같은 규칙으로 다시 다듬는다 — 여기는 요청을 스키마에 맞추고 로그의 개수를 맞추기 위한 것.)
  const order = sanitizeTeacherOrder(input.order);

  // 빈 순서 = 그 칸을 지운다(null). 과목이 설정에 없으면 저장 액션이 거절한다(없는 과목을 만들지 않는다).
  const res = await saveOperationsIntent("subject-fields", {
    subject: input.subject,
    fields: { teacherViewOrder: order.length ? order : null },
  });
  if (res?.error) return { error: res.error };

  await logAction({
    action: "owner_teacher_view_order_update",
    targetType: "tenant_settings",
    targetLabel: input.subject,
    metadata: { subject: input.subject, count: order.length },
  });
  return { ok: true };
}

export async function saveIntegrationGroups(input: IntegrationGroupsInput): Promise<IntegrationGroupsResult> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(input.subject)) return { error: "잘못된 과목 키입니다" };

  // 빈 제목 줄·줄 사이 반 중복·이름 없는 보관함 항목은 보내기 전에 걷어 낸다(요청 스키마가 빈 제목을 거절한다).
  // 🔴 같은 다듬기와 보관함의 '누가·언제' 도장은 **저장 액션이 방금 읽은 값으로** 다시 확정한다(subject-fields.ts) —
  //    여기서 도장을 찍어 보내지 않는다(보낸 도장은 버려진다). 현재 배치와 보관함이 같은 규칙을 타야 불러왔을 때 화면이 같다.
  const groups = sanitizeGroups(input.groups);
  const presets = input.presets?.flatMap((p) => {
    const cleaned = cleanPreset(p);
    return cleaned ? [cleaned] : [];
  });

  const res = await saveOperationsIntent("subject-fields", {
    subject: input.subject,
    fields: {
      integrationGroups: groups,
      integrationGroupsEnabled: input.enabled,
      integrationShowOthers: input.showOthers,
      // 빈 제목 = 그 칸을 지운다(null).
      integrationOthersTitle: input.othersTitle.trim() || null,
      // 안 넘겼으면 칸을 싣지 않는다 → 기존 보관함 보존. 빈 배열은 "다 지웠다"라 그대로 반영.
      ...(presets ? { integrationGroupPresets: presets } : {}),
    },
  });
  if (res?.error) return { error: res.error };
  // 서버가 도장을 찍어 저장한 보관함 — 화면이 방금 저장한 항목의 '누가·언제'를 바로 그린다.
  const stamped = presets ? res?.operations?.presets : undefined;

  await logAction({
    action: "owner_integration_groups_update",
    targetType: "tenant_settings",
    targetLabel: input.subject,
    metadata: {
      subject: input.subject,
      enabled: input.enabled,
      groups: groups.length,
      ...(presets ? { presets: presets.length } : null),
    },
  });
  // 🔴 도장이 찍힌 보관함을 **돌려준다** — 안 돌려주면 화면이 방금 저장한 항목을 "저장자 미상 ·
  //    시각 없음"으로 그린다(클라엔 도장이 없다). 새로고침해야 보이는 값은 없는 값이나 마찬가지.
  return { ok: true, presets: stamped };
}
