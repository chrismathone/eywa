"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import {
  getServiceAccountEmail,
  listSheetTabs,
  readSheetGridWithMerges,
} from "@/features/integrations/google-sheets";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { matchStructure } from "@/features/timetable/import/structure/match";
import { parseEywaTeacherGrid } from "@/features/timetable/import/structure/parse-eywa-grid";
import { parseTeacherGrid } from "@/features/timetable/import/structure/parse-grid";
import type { ExistingContext, SheetGrid } from "@/features/timetable/import/structure/types";
import { isPlanMonth, planMonthLabel } from "../types";
import {
  buildPlanSheetImport,
  detectGridLayout,
  parseSheetUrl,
  type PlanSheetImportPlan,
  type SheetTab,
} from "../lib/sheet-plan";
import { getPlanSlots } from "./queries";
import { requireTimetablePlanAccess } from "./access";

/**
 * 시간표(개발중) — **구글 시트 탭 하나를 그 달 계획으로 가져오기**.
 *
 * 원장 제보(2026-08-28): *"시트 별로 가져올수있어야할거같은데 그냥 가져오기하면 지금 고정값이라서 미래자료도
 * 가져오기힘듬"* — 맞다. 본 시간표의 구조 import는 탭 이름이 상수(`TEACHER_SHEET_NAME`)라 '9월시간표' 같은
 * 미래 탭을 가리킬 방법이 아예 없었다. 여기서는 **원장이 주소를 붙여넣어 탭을 고른다**.
 *
 * 🔴 **이 파일은 `class_schedules`에 한 행도 쓰지 않는다.** 계획은 `timetable_plan_slots`(0232a)에만 산다 —
 *    본 시간표 표는 출결·급여·청구 73곳이 함께 읽어서, 거기에 미래 달 배치가 섞이면 그 전부가 조용히 틀린
 *    답을 낸다(원장 확인: *"적용되면 지금 급여랑 출결이 모두 꼬이게 되자나"*). 구조 가드 = `isolation.test.ts`.
 *    본 시간표를 쓰는 공유 액션(`features/timetable/server/{import,structure-import}-actions`)도 **부르지 않는다**.
 *
 * 🔴 게이트는 조회·쓰기 셋 다 [`requireTimetablePlanAccess({ write: true })`] 하나다(#77). 목록 조회까지
 *    쓰기 게이트를 거는 이유: 이 액션들은 **사람이 준 문서 id로 서비스계정이 남의 문서를 읽는** 통로라,
 *    "탭 이름만 보는 것"도 열람 권한만으론 열지 않는다(어차피 이 화면은 편집 권한자만 쓴다).
 *
 * ⚠️ `timetable_plan_slots`는 RLS 정책 0개 + service_role 전용이라([[#104]]) admin 클라이언트로만 닿는다 →
 *    **모든 쿼리에 `tenant_id` 명시 필터**(RLS 우회이므로 빠뜨리면 타 학원 침범).
 */

const PLAN_TABLE = "timetable_plan_slots";
const INSERT_CHUNK = 500; // 한 문장이 지나치게 커지지 않게(타임아웃·메모리 방어)
/** 계획을 그 달에 쓸 때 쓰는 유니크 앵커 — 0232a의 **온전한** 유니크라 on conflict 추론이 된다([[#113]]). */
const PLAN_CONFLICT = "tenant_id,plan_month,class_id,day_of_week,start_time";

// ── 공용 결과 모양 ────────────────────────────────────────────────────────────

/**
 * 실패는 **항상 한글 요약(`error`) + 원문(`detail`)** 이다(UI에 raw 에러 원문 노출 금지 규약 —
 * 화면은 요약을 쓰고 원문은 `title` 툴팁으로만 보여준다). `serviceAccountEmail`은 늘 함께 돌려준다 —
 * 원장이 새로 만든 문서는 서비스계정에 공유가 안 돼 있는 게 가장 흔한 실패 원인이라, 화면이 "이 이메일에
 * 공유하세요"를 **에러가 나기 전부터** 보여줄 수 있어야 한다.
 */
export type PlanSheetFailure = { ok: false; error: string; detail?: string; serviceAccountEmail: string | null };

export type PlanSheetTabsResult =
  | {
      ok: true;
      spreadsheetId: string;
      tabs: SheetTab[];
      /** 주소에 gid가 있었다면 그 탭 이름(없으면 null — 사람이 고른다). */
      tabName: string | null;
      /** 문서 id를 연동 설정에서 가져왔는가(= 사람이 주소를 안 줬다). */
      fromSettings: boolean;
      serviceAccountEmail: string | null;
    }
  | PlanSheetFailure;

export type PlanSheetPreviewResult =
  | {
      ok: true;
      spreadsheetId: string;
      tabName: string;
      /** 어느 구조로 읽었는지(손시트/eywa export) — 0건일 때 원인을 짚을 유일한 단서. */
      layout: "master" | "eywa";
      plan: PlanSheetImportPlan;
      serviceAccountEmail: string | null;
    }
  | PlanSheetFailure;

export type PlanSheetApplyResult =
  | {
      ok: true;
      applied: { added: number; updated: number; kept: number; removed: number; skipped: number };
      month: string;
      tabName: string;
    }
  | (PlanSheetFailure & { stale?: boolean });

/** 시트를 다시 가져올 때 그 달을 어떻게 다룰지. */
export type PlanImportMode = "merge" | "replace";

// ── 실패 문구 ─────────────────────────────────────────────────────────────────

/**
 * 시트 읽기 실패 → 한글 요약. `readSheetGridWithMerges`·`listSheetTabs`는 이미 권한·404를 한글로 바꿔
 * 던지므로(그 안에 공유 안내가 들어 있다) **한글이면 그대로 쓰고**, 영문 원문만 남은 경우에만 우리가
 * 요약을 만든다(원문은 detail로 넘겨 툴팁에서 볼 수 있게 한다).
 */
function sheetFailure(e: unknown): PlanSheetFailure {
  const detail = e instanceof Error ? e.message : String(e);
  const email = getServiceAccountEmail();
  const korean = /[가-힣]/.test(detail);
  return {
    ok: false,
    error: korean
      ? detail
      : `구글 시트를 읽지 못했습니다 — 주소가 맞는지, ${email ? `시트를 '${email}' 계정에 공유했는지` : "시트 공유 설정"} 확인해 주세요.`,
    detail,
    serviceAccountEmail: email,
  };
}

function fail(error: string, detail?: string): PlanSheetFailure {
  return { ok: false, error, detail, serviceAccountEmail: getServiceAccountEmail() };
}

// ── 대상 문서·탭 해석 ─────────────────────────────────────────────────────────

/**
 * 문서 id를 정한다 — 사람이 준 주소가 **항상 이긴다**. 없을 때만 연동 설정(영어 → 수학 순)에서 찾는다.
 * ⚠️ 연동의 `sync_enabled`(시트 내보내기 토글)는 보지 않는다 — 그 토글은 eywa가 시트를 **덮어쓰는**
 *    경로를 여닫는 스위치고, 여기는 시트를 **읽기만** 한다(꺼져 있다고 못 읽을 이유가 없다).
 */
async function resolveSpreadsheetId(
  source?: string,
): Promise<{ id: string; gid: number | null; fromSettings: boolean } | PlanSheetFailure> {
  const raw = String(source ?? "").trim();
  if (raw) {
    const parsed = parseSheetUrl(raw);
    if (!parsed)
      return fail(
        "구글 시트 주소를 알아볼 수 없습니다 — 시트를 열고 주소창을 통째로 복사해 붙여넣어 주세요(docs.google.com/spreadsheets/… 형태).",
      );
    return { id: parsed.spreadsheetId, gid: parsed.gid, fromSettings: false };
  }
  // 설정 두 곳은 서로 독립이라 병렬(B4).
  const [english, math] = await Promise.all([getGoogleSheetsStatus("english"), getGoogleSheetsStatus("math")]);
  const id = english.spreadsheetId?.trim() || math.spreadsheetId?.trim() || null;
  if (!id)
    return fail("연결된 구글 시트가 없습니다 — 가져올 시트 주소를 붙여넣어 주세요.");
  return { id, gid: null, fromSettings: true };
}

// ── ① 탭 목록 ────────────────────────────────────────────────────────────────

/**
 * 문서의 탭 목록. 주소를 주면 그 문서, 안 주면 연동 설정의 시트.
 * 주소에 gid가 있으면 그 탭 이름까지 찾아 돌려준다(화면이 그 탭을 미리 골라 둔다).
 */
export async function listPlanImportTabs(source?: string): Promise<PlanSheetTabsResult> {
  const gate = await requireTimetablePlanAccess({ write: true });
  if (!gate.ok) return fail(gate.error);

  const target = await resolveSpreadsheetId(source);
  if ("ok" in target) return target;

  try {
    const tabs = await listSheetTabs(target.id);
    if (tabs.length === 0) return fail("그 문서에서 탭을 찾지 못했습니다 — 주소를 다시 확인해 주세요.");
    let tabName: string | null = null;
    if (target.gid !== null) {
      const hit = tabs.find((t) => t.gid === target.gid);
      if (!hit)
        return fail(
          `그 시트 탭을 찾을 수 없습니다 — 주소를 다시 확인해주세요(문서에 있는 탭: ${tabs
            .slice(0, 8)
            .map((t) => t.title)
            .join(" · ")}${tabs.length > 8 ? " …" : ""}).`,
        );
      tabName = hit.title;
    }
    return {
      ok: true,
      spreadsheetId: target.id,
      tabs,
      tabName,
      fromSettings: target.fromSettings,
      serviceAccountEmail: getServiceAccountEmail(),
    };
  } catch (e) {
    return sheetFailure(e);
  }
}

// ── ② 시트 → 계획 계산(미리보기·적용 공용) ─────────────────────────────────────

type Computed = {
  spreadsheetId: string;
  tabName: string;
  layout: "master" | "eywa";
  plan: PlanSheetImportPlan;
  tenantId: string;
};

/**
 * 시트와 DB를 **지금 다시 읽어** 계획을 계산한다(무쓰기). 미리보기·적용의 단일 소스 —
 * 적용은 화면이 보낸 행 목록을 믿지 않고 이 결과로만 쓴다(클라 계획 불신, 구조 import와 같은 원칙).
 */
async function computePlan(
  tenantId: string,
  month: string,
  source: string | undefined,
  tabNameOpt: string | undefined,
): Promise<Computed | PlanSheetFailure> {
  const target = await resolveSpreadsheetId(source);
  if ("ok" in target) return target;

  // 탭 이름 확정 — 화면이 고른 이름이 우선, 없으면 주소의 gid로 찾는다.
  let tabName = String(tabNameOpt ?? "").trim();
  if (!tabName) {
    if (target.gid === null)
      return fail("가져올 시트 탭을 골라 주세요(주소에 탭 번호가 없습니다).");
    try {
      const tabs = await listSheetTabs(target.id);
      const hit = tabs.find((t) => t.gid === target.gid);
      if (!hit) return fail("그 시트 탭을 찾을 수 없습니다 — 주소를 다시 확인해주세요.");
      tabName = hit.title;
    } catch (e) {
      return sheetFailure(e);
    }
  }

  let grid: SheetGrid;
  try {
    grid = await readSheetGridWithMerges(target.id, tabName);
  } catch (e) {
    return sheetFailure(e);
  }

  const layout = detectGridLayout(grid);
  const parsed = layout === "eywa" ? parseEywaTeacherGrid(grid) : parseTeacherGrid(grid);
  if (parsed.slots.length === 0)
    return fail(
      `'${tabName}' 탭에서 수업 칸을 하나도 읽지 못했습니다 — 강사별 시간표 탭이 맞는지 확인해 주세요.`,
      parsed.warnings.slice(0, 5).join(" / "),
    );

  const admin = createAdminClient();
  // 넷은 서로 의존하지 않는다 → 병렬(B4). 전건 조회는 전부 페이지네이션(B2 — 1000행 silent 절단 방지).
  const [classRows, userRows, roomRows, existing] = await Promise.all([
    fetchAllPaged<{
      id: string;
      class_name: string;
      subject: string;
      teacher_id: string | null;
      classroom_id: string | null;
      is_active: boolean | null;
    }>((from, to) =>
      admin
        .from("classes")
        .select("id, class_name, subject, teacher_id, classroom_id, is_active")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ id: string; display_name: string; english_name: string | null; system_role: string }>(
      (from, to) =>
        admin
          .from("users")
          .select("id, display_name, english_name, system_role")
          .eq("tenant_id", tenantId)
          .eq("status", "active")
          .order("id")
          .range(from, to),
    ),
    fetchAllPaged<{ id: string; name: string }>((from, to) =>
      admin.from("classrooms").select("id, name").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
    getPlanSlots(month),
  ]);

  // 🔴 이름이 겹치는 반은 매칭에서 **뺀다** — 시트는 반 이름만 주는데 같은 이름이 둘이면 어느 쪽인지 알
  //    방법이 없다(매처는 Map이라 조용히 마지막 것을 집는다 = 남의 반에 계획이 붙는다). 뺀 반의 칸은
  //    '반을 못 찾음'으로 사람에게 보인다 — 조용히 틀리는 것보다 낫다.
  const active = classRows.filter((c) => c.is_active !== false);
  const nameCount = new Map<string, number>();
  for (const c of active) {
    const k = c.class_name.trim().replace(/\s+/g, " ").toLowerCase();
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const ambiguous = new Set([...nameCount.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  const ctx: ExistingContext = {
    classes: active
      .filter((c) => !ambiguous.has(c.class_name.trim().replace(/\s+/g, " ").toLowerCase()))
      .map((c) => ({
        id: c.id,
        className: c.class_name,
        subject: c.subject,
        teacherId: c.teacher_id,
        classroomId: c.classroom_id,
      })),
    teachers: userRows.map((u) => ({
      id: u.id,
      englishName: u.english_name,
      displayName: u.display_name,
      systemRole: u.system_role,
    })),
    classrooms: roomRows.map((r) => ({ id: r.id, name: r.name })),
  };

  const match = matchStructure(parsed, ctx);
  const plan = buildPlanSheetImport(match.resolved, existing, {
    classNameById: new Map(classRows.map((c) => [c.id, c.class_name])),
  });

  // 파서 경고(요일 헤더 못 읽음 등)는 사람이 봐야 한다 — 그 열의 수업이 통째로 빠지기 때문.
  plan.warnings.unshift(...parsed.warnings);
  if (ambiguous.size > 0)
    plan.warnings.push(
      `이름이 같은 반이 여럿이라 자동 매칭에서 제외했습니다(${ambiguous.size}종) — 반 이름을 구분되게 고친 뒤 다시 가져오세요.`,
    );

  return { spreadsheetId: target.id, tabName, layout, plan, tenantId };
}

/** 시트 한 탭이 그 달 계획에 무엇을 더하고 바꾸는지 **미리보기**(DB 미변경). */
export async function previewPlanSheetImport(args: {
  month: string;
  /** 원장이 붙여넣은 시트 주소(또는 문서 id). 비우면 연동 설정의 시트. */
  source?: string;
  /** 화면 드롭다운이 고른 탭 이름. 없으면 주소의 gid로 찾는다. */
  tabName?: string;
}): Promise<PlanSheetPreviewResult> {
  const gate = await requireTimetablePlanAccess({ write: true });
  if (!gate.ok) return fail(gate.error);
  if (!isPlanMonth(args.month)) return fail("달 형식이 올바르지 않습니다(예: 2026-09)");

  try {
    const res = await computePlan(gate.access.tenantId, args.month, args.source, args.tabName);
    if ("ok" in res) return res;
    return {
      ok: true,
      spreadsheetId: res.spreadsheetId,
      tabName: res.tabName,
      layout: res.layout,
      plan: res.plan,
      serviceAccountEmail: getServiceAccountEmail(),
    };
  } catch (e) {
    return fail("시트를 계획으로 바꾸지 못했습니다 — 잠시 후 다시 시도해 주세요.", e instanceof Error ? e.message : String(e));
  }
}

// ── ③ 적용 ───────────────────────────────────────────────────────────────────

/**
 * 미리보기에서 확인한 것을 **`timetable_plan_slots`에만** 반영한다.
 *
 * 🔑 **기본 모드는 `merge`(병합)** 다 — 시트에 있는 칸만 만들거나 고치고, 시트에 없는 기존 계획 칸은
 *    **손대지 않는다**. `replace`(그 달을 통째로 지우고 다시 채우기)를 기본값으로 두지 않은 이유:
 *    ① 계획은 사람이 화면에서 손으로 고치는 곳이고(합반 묶음·교시 라벨은 시트가 아예 표현하지 못한다),
 *    ② 되돌릴 문이 없다(계획엔 스냅샷·롤백이 없다 — 지우면 끝),
 *    ③ 시트 탭 하나가 학원 전체를 담는다는 보장이 없다(영어 마스터 탭만 가져오면 수학 계획이 통째로
 *       사라진다). 통째 교체는 사람이 화면에서 명시적으로 고를 때만 한다.
 */
export async function applyPlanSheetImport(args: {
  month: string;
  source?: string;
  tabName?: string;
  /** 기본 'merge'(안전). 'replace'는 그 달을 지우고 시트 내용으로 다시 채운다. */
  mode?: PlanImportMode;
  /** 미리보기에서 받은 해시 — 그 사이 시트·계획이 바뀌었으면 중단한다(주면 검사, 없으면 건너뜀). */
  expectedHash?: string;
}): Promise<PlanSheetApplyResult> {
  const gate = await requireTimetablePlanAccess({ write: true });
  if (!gate.ok) return fail(gate.error);
  const { month } = args;
  if (!isPlanMonth(month)) return fail("달 형식이 올바르지 않습니다(예: 2026-09)");
  const mode: PlanImportMode = args.mode === "replace" ? "replace" : "merge";
  const tenantId = gate.access.tenantId;

  try {
    const res = await computePlan(tenantId, month, args.source, args.tabName);
    if ("ok" in res) return res;
    const { plan, tabName } = res;

    if (args.expectedHash && args.expectedHash !== plan.hash)
      return {
        ...fail("미리보기 이후 시트나 계획이 바뀌었습니다 — 다시 불러온 뒤 적용해 주세요."),
        stale: true,
      };

    // 🔴 통째 교체인데 **담을 칸이 하나도 없으면 중단**한다 — 시트 탭을 잘못 골랐거나 반 이름이 하나도
    //    안 맞은 경우(전부 skipped)에도 rows가 0이 되는데, 그대로 진행하면 그 달 계획만 **깨끗이 지워진다**.
    //    되돌릴 문이 없는 삭제라, "아무것도 못 읽었다"와 "다 지워라"를 같은 동작으로 두지 않는다.
    if (mode === "replace" && plan.rows.length === 0)
      return fail(
        `'${tabName}' 탭에서 ${planMonthLabel(month)} 계획에 담을 칸을 하나도 찾지 못해 통째 교체를 중단했습니다(기존 계획은 그대로 뒀습니다).`,
      );

    const writable = mode === "replace" ? plan.rows : plan.rows.filter((r) => r.action !== "keep");
    if (writable.length === 0 && !(mode === "replace" && plan.orphans.length > 0))
      return {
        ok: true,
        applied: { added: 0, updated: 0, kept: plan.counts.keep, removed: 0, skipped: plan.counts.skipped },
        month,
        tabName,
      };

    const admin = createAdminClient();
    const now = new Date().toISOString();
    // 🔴 `tenant_id`는 여기서 만들지 않는다 — **쓰기 직전 한 곳**(아래 upsert)에서 못 박는다.
    //    admin은 RLS를 우회하므로 그 값이 유일한 학원 경계이고, 한 자리에 모아 두면 빠뜨릴 곳이 없다.
    const rows = writable.map((r) => ({
      plan_month: month,
      class_id: r.input.classId,
      day_of_week: r.input.dayOfWeek,
      start_time: r.input.startTime,
      end_time: r.input.endTime,
      teacher_id: r.input.teacherId,
      classroom_id: r.input.classroomId,
      slot_teacher_label: r.input.slotTeacherLabel,
      slot_room_label: r.input.slotRoomLabel,
      period_label: r.input.periodLabel,
      merge_group: r.input.mergeGroup,
      source_schedule_id: r.input.sourceScheduleId,
      // ⚠️ 0232a는 updated_at 갱신 트리거가 없다 → 쓰기마다 직접 넣는다(안 넣으면 월 목록의 '마지막 수정'이
      //    생성 시각에 굳는다).
      updated_at: now,
    }));

    let removed = 0;
    if (mode === "replace") {
      const { data, error } = await admin
        .from(PLAN_TABLE)
        .delete()
        .eq("tenant_id", tenantId) // 🔴 admin = RLS 우회 — 이 줄이 타 학원 계획 삭제를 막는 유일한 방어
        .eq("plan_month", month)
        .select("id");
      if (error) throw new Error(error.message);
      removed = data?.length ?? 0;
    }

    // 청크는 서로 독립인 문장이라 병렬(B4). 하나라도 실패하면 전체를 실패로 올린다(부분 반영을 숨기지 않는다).
    const chunks: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) chunks.push(rows.slice(i, i + INSERT_CHUNK));
    const results = await Promise.all(
      chunks.map((c) =>
        admin
          .from(PLAN_TABLE)
          // 행마다 `tenant_id`를 실어 보낸다 — admin은 RLS 우회라 이 값이 유일한 학원 경계다.
          .upsert(
            c.map((row) => ({ ...row, tenant_id: tenantId })),
            { onConflict: PLAN_CONFLICT },
          )
          .select("id"),
      ),
    );
    for (const r of results) if (r.error) throw new Error(r.error.message);

    const applied = {
      added: plan.counts.add,
      updated: plan.counts.update,
      kept: plan.counts.keep,
      // replace는 그 달을 지우고 다시 넣으므로, 사라진 것은 '시트에 없던 칸'(orphan)뿐이다.
      removed: mode === "replace" ? plan.counts.orphan : 0,
      skipped: plan.counts.skipped,
    };

    await logAction({
      action: "timetable_plan_sheet_import",
      targetType: "timetable_plan",
      targetLabel: `${planMonthLabel(month)} ← '${tabName}'`,
      metadata: {
        month,
        tabName,
        spreadsheetId: res.spreadsheetId,
        layout: res.layout,
        mode,
        ...applied,
        deletedRows: removed,
      },
    });
    revalidatePath("/timetable-dev");
    return { ok: true, applied, month, tabName };
  } catch (e) {
    return fail("계획에 반영하지 못했습니다 — 잠시 후 다시 시도해 주세요.", e instanceof Error ? e.message : String(e));
  }
}
