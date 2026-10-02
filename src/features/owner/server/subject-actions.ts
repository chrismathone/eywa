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
import { resolveSettings } from "../resolve";
import { isValidSubjectKey } from "../subject-absorb";
import type { IntegrationGroupPresetSetting } from "../settings-types";
import { saveOwnerSection } from "./actions";
import { logDbError } from "@/lib/supabase/db-error";

const SCALAR_TABLES = [
  { table: "classes", label: "반" },
  { table: "enrollment_consultations", label: "콜&상담" },
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
};

type OwnerWriteGate =
  | { error: string; actor?: undefined }
  | { error?: undefined; actor: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> };

// 과목 운영 탭 = owner 콘솔 소속 → 게이트도 owner 메뉴 쓰기(override 반영, #58) — 원장이 위임하면 열림.
// (내부의 설정 행 제거는 saveOwnerSection(operations) 경유라 동일 게이트로 정합.)
async function requireOwnerWrite(): Promise<OwnerWriteGate> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "operations_settings"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" };
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
      if (error) throw new Error(`${table}: ${error.message}`);
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

  const [scalars, tc, dc, oc, pc] = await Promise.all([
    scalarCounts,
    teacherCount,
    detailsCount,
    onescreenCount,
    periodCount,
  ]);
  if (tc.error) throw new Error(`users: ${tc.error.message}`);
  if (dc.error) throw new Error(`subject_details: ${dc.error.message}`);
  if (oc.error) throw new Error(`subject_progress: ${oc.error.message}`);
  const items = [
    ...scalars,
    { label: "담당 강사", count: tc.count ?? 0 },
    { label: "상담 과목별 점수", count: dc.count ?? 0 },
    { label: "원스크린 세션", count: oc.count ?? 0 },
    { label: "세션 기간", count: pc },
  ].filter((i) => i.count > 0);
  return { total: items.reduce((a, b) => a + b.count, 0), items };
}

/** 과목 키를 참조하는 데이터 건수(표면별) — 삭제 다이얼로그 표시용. */
export async function getSubjectUsage(key: string): Promise<SubjectUsage | { error: string }> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(key)) return { error: "잘못된 과목 키입니다" };
  try {
    return await countSubjectUsage(await createClient(), gate.actor.tenantId, key);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "사용량 조회 실패" };
  }
}

/** DB에서 설정을 fresh로 읽어 해석(React cache/unstable_cache 우회) — read-modify-write 창 최소화. */
async function readFreshOperations(supabase: Supabase, tenantId: string) {
  const { data: existing, error } = await supabase
    .from("tenant_settings")
    .select("data")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`tenant_settings: ${error.message}`);
  // resolveSettings는 순수(profile.name 폴백만 tenant명 사용 — operations에 무관).
  return resolveSettings(existing?.data ?? null, { name: "" }).operations;
}

/** 설정 subjects에서 key 행 제거 — saveOwnerSection 경유(단일 쓰기 경로). 행이 없으면 no-op. */
async function removeSubjectRowFromSettings(supabase: Supabase, tenantId: string, key: string) {
  const operations = await readFreshOperations(supabase, tenantId);
  if (!operations.subjects.some((s) => s.key === key)) return { ok: true as const };
  const nextOperations = { ...operations, subjects: operations.subjects.filter((s) => s.key !== key) };
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("data", JSON.stringify(nextOperations));
  const res = await saveOwnerSection(undefined, fd);
  if (res?.error) return { error: res.error };
  return { ok: true as const };
}

export type AbsorbResult = { ok?: boolean; moved?: number; error?: string };

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
    return { error: e instanceof Error ? e.message : "반 이름 충돌 점검 실패" };
  }

  let moved = 0;
  const detail: Record<string, number> = {};

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
      return { error: `${table}: ${error.message}` };
    }
    if (count) {
      moved += count;
      detail[table] = count;
    }
  }

  // 2) users.subjects[] + jsonb 2곳 — 0077a RPC(원자 단일 문, 현재 행 값 기준)로 일괄 이동
  {
    const { data, error } = await supabase.rpc("absorb_subject_key", { p_from: from, p_to: to });
    if (error) return { error: `absorb_subject_key: ${error.message}` };
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
      return { error: e instanceof Error ? e.message : "세션 기간 이동 실패" };
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

  // 3) 설정에서 from 과목 행 제거 — 저장 직전 fresh 재읽기(흡수 진행 중 다른 창의 설정 저장분 보존)
  const removed = await removeSubjectRowFromSettings(supabase, t, from);
  if ("error" in removed && removed.error) {
    return { error: `데이터는 옮겼지만 설정 저장 실패: ${removed.error}` };
  }

  await logAction({
    action: "owner_subject_absorb",
    targetType: "tenant_settings",
    targetLabel: `${fromLabel} → ${toRow.label || to}`,
    metadata: { from, to, moved, detail },
  });

  return { ok: true, moved };
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
    if (usage.total > 0) {
      return { error: `그 사이 이 과목을 쓰는 데이터가 ${usage.total}건 생겼습니다 — 흡수 삭제를 사용해 주세요.` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "사용량 재검증 실패" };
  }

  const removed = await removeSubjectRowFromSettings(supabase, t, key);
  if ("error" in removed && removed.error) return { error: removed.error };

  await logAction({
    action: "owner_subject_delete",
    targetType: "tenant_settings",
    targetLabel: key,
    metadata: { key },
  });

  return { ok: true, moved: 0 };
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
 * ⚠️ read-modify-write라 fresh 읽기(readFreshOperations) 후 **그 과목 행만** 교체한다. 폼 전체를
 * 덮어쓰면 같은 시각 과목 운영 탭에서 저장한 다른 설정이 날아간다.
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
  const supabase = await createClient();

  let operations;
  try {
    operations = await readFreshOperations(supabase, gate.actor.tenantId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "설정 읽기 실패" };
  }
  if (!operations.subjects.some((s) => s.key === input.subject)) {
    return { error: "학원 설정에 없는 과목입니다" };
  }

  // 빈 값·중복 제거(먼저 나온 것이 이긴다) — 중복이 있으면 정렬 인덱스가 갈려 순서가 흔들린다.
  const seen = new Set<string>();
  const order = input.order
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n) && (seen.add(n), true));

  const nextOperations = {
    ...operations,
    subjects: operations.subjects.map((s) =>
      s.key === input.subject ? { ...s, teacherViewOrder: order.length ? order : undefined } : s,
    ),
  };
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("data", JSON.stringify(nextOperations));
  const res = await saveOwnerSection(undefined, fd);
  if (res?.error) return { error: res.error };

  await logAction({
    action: "owner_teacher_view_order_update",
    targetType: "tenant_settings",
    targetLabel: input.subject,
    metadata: { subject: input.subject, count: order.length },
  });
  return { ok: true };
}

/**
 * 빈 제목 줄은 저장 단계에서 버린다(화면에서 이름 없는 섹션이 생기지 않게). 반 중복 배정도 여기서
 * 정리 — 먼저 나온 줄이 갖는다(렌더 규칙 applyCustomGroups와 같은 순서라 화면·저장이 안 어긋난다).
 * 현재 배치와 보관함(프리셋)이 **같은 규칙**을 타야 불러왔을 때 화면이 달라지지 않는다.
 */
function sanitizeGroups(groups: { id: string; title: string; classIds: string[] }[]) {
  const seen = new Set<string>();
  return groups
    .map((g) => ({ ...g, title: g.title.trim() }))
    .filter((g) => g.title)
    .map((g) => ({
      id: g.id,
      title: g.title,
      classIds: g.classIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
    }));
}

export async function saveIntegrationGroups(input: IntegrationGroupsInput): Promise<IntegrationGroupsResult> {
  const gate = await requireOwnerWrite();
  if (gate.error !== undefined) return { error: gate.error };
  if (!isValidSubjectKey(input.subject)) return { error: "잘못된 과목 키입니다" };
  const supabase = await createClient();

  let operations;
  try {
    operations = await readFreshOperations(supabase, gate.actor.tenantId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "설정 읽기 실패" };
  }
  if (!operations.subjects.some((s) => s.key === input.subject)) {
    return { error: "학원 설정에 없는 과목입니다" };
  }

  const groups = sanitizeGroups(input.groups);

  // 보관함(프리셋) — 저장 시점에 같은 위생 규칙을 태운다(빈 제목 줄 제거·줄 안 반 중복 제거).
  // 이름 없는 프리셋은 버린다(목록에서 고를 수 없는 유령 항목이 된다).
  //
  // 🔴 '누가·언제'는 **서버가 찍는다** — 클라가 보낸 savedBy를 그대로 믿으면 남의 이름으로 저장한 것처럼
  //    꾸밀 수 있다. 내용이 그대로인 프리셋은 **기존 도장을 유지**한다(다른 프리셋을 하나 만들었다고
  //    나머지 전부의 저장 시각이 오늘로 바뀌면 "언제 만든 배치인지"가 통째로 거짓이 된다).
  const prevPresets = operations.subjects.find((s) => s.key === input.subject)?.integrationGroupPresets ?? [];
  const prevById = new Map(prevPresets.map((p) => [p.id, p]));
  const stampedAt = new Date().toISOString();
  // ⚠️ 객체를 그대로 stringify하면 **키 순서**에 걸린다 — 저장본은 jsonb라 Postgres가 키를 재정렬해
  //    돌려주므로, JS 리터럴 순서와 우연히 같지 않으면 "안 바뀐 프리셋"이 매번 바뀐 걸로 잡혀
  //    저장 시각이 계속 갱신된다. 배열로 눕혀 순서를 못박는다.
  const bodyOf = (p: {
    name: string;
    groups?: { id: string; title: string; classIds?: string[] }[];
    showOthers?: boolean;
    othersTitle?: string;
  }) =>
    JSON.stringify([
      p.name,
      (p.groups ?? []).map((g) => [g.id, g.title, g.classIds ?? []]),
      p.showOthers !== false,
      p.othersTitle ?? "",
    ]);
  const presets = input.presets
    ?.map((p) => {
      const cleaned = {
        id: p.id,
        name: p.name.trim(),
        groups: sanitizeGroups(p.groups),
        showOthers: p.showOthers,
        othersTitle: p.othersTitle?.trim() || undefined,
      };
      const before = prevById.get(p.id);
      const unchanged = before && bodyOf(before) === bodyOf(cleaned);
      return unchanged
        ? { ...cleaned, savedBy: before.savedBy, savedAt: before.savedAt }
        : { ...cleaned, savedBy: gate.actor.displayName ?? undefined, savedAt: stampedAt };
    })
    .filter((p) => p.name);

  const nextOperations = {
    ...operations,
    subjects: operations.subjects.map((s) =>
      s.key === input.subject
        ? {
            ...s,
            integrationGroups: groups,
            integrationGroupsEnabled: input.enabled,
            integrationShowOthers: input.showOthers,
            integrationOthersTitle: input.othersTitle.trim() || undefined,
            // undefined = "안 넘겼다" → 기존 보관함 보존. 빈 배열은 "다 지웠다"라 그대로 반영.
            integrationGroupPresets: presets ?? s.integrationGroupPresets,
          }
        : s,
    ),
  };
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("data", JSON.stringify(nextOperations));
  const res = await saveOwnerSection(undefined, fd);
  if (res?.error) return { error: res.error };

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
  return { ok: true, presets: presets ?? undefined };
}
