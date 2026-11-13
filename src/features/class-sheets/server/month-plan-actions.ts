"use server";

/**
 * 월간 계획서(MP) 저장 — **쓰기 경로는 이 액션 하나뿐이다.**
 *
 * 칸 편집 · "e-book 열 추가/숨기기" · 휴강 토글이 전부 같은 패치 배열로 내려온다. 셋이 각자
 * 액션을 가지면 게이트를 세 번 적어야 하고, 한 곳만 고쳐지는 날이 온다(#77).
 *
 * 🔴 게이트는 둘을 **함께** 통과해야 한다.
 *   ① `requireEcsClassAccess(classId, { write: true })` — ECS 메뉴 권한 + 담당 반 스코프.
 *   ② `english_track === "eie"` — MP는 EiE 반에만 있다(원장 2026-09-01). 화면에서 탭만 숨기면
 *      주소를 직접 치면 열린다(#77) → 서버에서 다시 본다. **반 이름으로 추측하지 않는다.**
 *
 * 🔑 `body: null` = **행 삭제**, `body: ""` = **빈 채로 남긴다**. 뜻이 다르다 —
 *    빈 `ebook` 행이 그 요일의 4번째 열을 세우므로(0239a 헤더 참조) "지우기"와 "비우기"를 갈라야 한다.
 *
 * ⚠️ `class_month_plan_cells`는 RLS 정책 0개(service_role 전용)라 admin으로 쓰되 **모든 조건에
 *    `tenant_id`를 명시**한다([[#104]]).
 * ⚠️ 이 파일은 `"use server"`라 **async 함수만 export**할 수 있다([[#119]]) — 상수·순수 헬퍼는
 *    [`lib/month-plan.ts`](../lib/month-plan.ts)에 둔다.
 */
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { mpStructuralChange, type MpSaveIntent } from "../lib/edit-audit";
import { MP_ALL_COLUMNS, MP_TITLE_MAX, type MpColKind } from "../lib/month-plan";
import { YMD_RE } from "../lib/week";
import { requireEcsClassAccess } from "./access";
import { eieModuleOn } from "./eie-on";

export type MpCellPatch = {
  date: string;
  colKind: MpColKind;
  /** `null`이면 그 칸을 지운다. 빈 문자열은 "칸은 남기고 내용만 비운다". */
  body: string | null;
};

type MpSaveResult = { ok: true } | { ok: false; error: string };

/** 한 번에 보낼 수 있는 칸 수 — 한 달 수업일(≤31) × 칸 5종보다 넉넉하되 무한은 아니게. */
const MAX_PATCHES = 160;
/** 0239a `body` CHECK와 같은 값 — 서버가 먼저 걸러 DB 오류 원문이 화면에 뜨지 않게 한다. */
const MAX_BODY = 2000;
const OFF_VALUES = new Set(["off", "open"]);

export async function saveMonthPlanCells(input: {
  classId: string;
  patches: MpCellPatch[];
  /**
   * 이 저장이 **토글**인가(e-book 열 세우기/내리기 · 휴강 표시) — 있으면 감사로그를 이 저장에서 한 줄 남긴다.
   * 칸 글쓰기는 안 넘긴다(그쪽은 칸을 떠날 때 `commitSheetEdits`가 한 줄, 원장 결정 2026-09-14).
   * 🔴 쓰기에는 아무 영향이 없다 — 기록의 이름표일 뿐이고, 패치 모양과 안 맞으면 버린다(`mpStructuralChange`).
   */
  intent?: MpSaveIntent;
}): Promise<MpSaveResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(await eieModuleOn()) || gate.access.englishTrack !== "eie") {
    return { ok: false, error: "이 화면에서는 저장할 수 없습니다" };
  }

  const patches = input.patches ?? [];
  if (patches.length === 0) return { ok: true };
  if (patches.length > MAX_PATCHES) return { ok: false, error: "한 번에 저장할 칸이 너무 많습니다" };

  // `off`(상태 표식)·`footer`(문서 아래 한 덩어리, 0240a)는 격자 열이 아니지만 같은 표에 산다.
  // `title`(s2_0007 — 반이 고친 제목 · 그 달 1일) — 한 줄이라 짧게 받는다.
  const kinds = new Set<MpColKind>([...MP_ALL_COLUMNS, "off", "footer", "title"]);
  for (const p of patches) {
    if (!YMD_RE.test(p?.date ?? "")) return { ok: false, error: "잘못된 요청입니다(날짜)" };
    if (!kinds.has(p?.colKind)) return { ok: false, error: "잘못된 요청입니다(칸 종류)" };
    if (p.body !== null && typeof p.body !== "string") return { ok: false, error: "잘못된 요청입니다(내용)" };
    if ((p.body?.length ?? 0) > MAX_BODY) return { ok: false, error: "입력이 너무 깁니다(2000자 이내)" };
    // 🔴 `off`는 자유 텍스트가 아니라 상태 표식이다 — 아무 글자나 받으면 `readMpOffOverride`가
    //    'auto'로 읽어 **저장은 됐는데 아무 일도 안 일어나는** 칸이 된다.
    if (p.colKind === "title" && (p.body?.length ?? 0) > MP_TITLE_MAX) return { ok: false, error: `제목은 ${MP_TITLE_MAX}자 이내로 입력하세요` };
    if (p.colKind === "off" && p.body !== null && !OFF_VALUES.has(p.body)) {
      return { ok: false, error: "잘못된 요청입니다(휴강 표시)" };
    }
  }

  const admin = createAdminClient();
  const { tenantId, user } = gate.access;
  const now = new Date().toISOString();

  // 표가 아직 없을 때(0239a 미적용) PostgREST 원문을 그대로 띄우지 않는다 — 화면에 영문 기술 원문을
  // 내보내지 않는 규칙. 원인을 한글로 말하고 무엇을 해야 하는지 알린다(0230a Shouting과 같은 규약).
  const saveError = (e: { code?: string; message: string }) =>
    e.code === "42P01" || e.code === "PGRST205"
      ? "월간 계획서 기능이 아직 준비되지 않았습니다(DB 갱신 필요) — 관리자에게 알려주세요"
      : explainDbError(e, { scope: "class-sheets.monthPlan", fallback: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }).message;

  // 삭제는 **칸 종류별로 묶어** 한 번씩(한 달치라도 날짜가 ≤31개라 `.in()` 길이 걱정이 없다 — B3).
  const byKind = new Map<MpColKind, string[]>();
  for (const p of patches) {
    if (p.body !== null) continue;
    const list = byKind.get(p.colKind) ?? [];
    list.push(p.date);
    byKind.set(p.colKind, list);
  }
  for (const [colKind, dates] of byKind) {
    const { error } = await admin
      .from("class_month_plan_cells")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("col_kind", colKind)
      .in("plan_date", dates);
    if (error) return { ok: false, error: saveError(error) };
  }

  const rows = patches
    .filter((p) => p.body !== null)
    .map((p) => ({
      tenant_id: tenantId,
      class_id: input.classId,
      plan_date: p.date,
      col_kind: p.colKind,
      body: p.body as string,
      updated_by: user.id,
      updated_at: now,
    }));
  if (rows.length > 0) {
    const { error } = await admin.from("class_month_plan_cells").upsert(rows, {
      // ⚠️ 유니크가 **부분 인덱스가 아니라서** 이 추론이 성립한다([[#113]]).
      onConflict: "tenant_id,class_id,plan_date,col_kind",
    });
    if (error) return { ok: false, error: saveError(error) };
  }
  // 감사로그 — 열/휴강 토글은 누름이 곧 결심이라 **이 저장에서** 한 줄(응답을 붙잡지 않게 after).
  const structural = mpStructuralChange(input.intent, patches);
  if (structural) {
    after(() =>
      logAction({
        action: "ecs_month_plan_edit",
        targetType: "class_sheet",
        targetLabel: gate.access.className,
        metadata: { classId: input.classId, ...structural },
      }),
    );
  }
  return { ok: true };
}
