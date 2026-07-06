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
import { resolveSettings } from "../resolve";
import { isValidSubjectKey } from "../subject-absorb";
import { saveOwnerSection } from "./actions";

const SCALAR_TABLES = [
  { table: "classes", label: "반" },
  { table: "enrollment_consultations", label: "등록상담" },
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
  if (!(await canWriteTenant(actor.systemRole, "owner"))) {
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

  const [scalars, tc, dc, oc] = await Promise.all([scalarCounts, teacherCount, detailsCount, onescreenCount]);
  if (tc.error) throw new Error(`users: ${tc.error.message}`);
  if (dc.error) throw new Error(`subject_details: ${dc.error.message}`);
  if (oc.error) throw new Error(`subject_progress: ${oc.error.message}`);
  const items = [
    ...scalars,
    { label: "담당 강사", count: tc.count ?? 0 },
    { label: "상담 과목별 점수", count: dc.count ?? 0 },
    { label: "원스크린 세션", count: oc.count ?? 0 },
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
