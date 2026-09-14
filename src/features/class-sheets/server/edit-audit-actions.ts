"use server";

/**
 * 강사 시트(ECS) **칸 편집 감사로그** — "칸 입력을 마칠 때 한 줄"(원장 결정 2026-09-14).
 * 규약(모양 검증·변동 판정·자르기·라벨)은 [`lib/edit-audit.ts`](../lib/edit-audit.ts) 한 벌이고, 여기는
 * **문(게이트)과 DB 다시 읽기**뿐이다. 클라 쪽은 [`useSheetEditAudit`](../components/use-sheet-edit-audit.ts).
 *
 * 🔴 게이트 = 저장 액션과 **같은 문**: `requireEcsClassAccess(classId, { write: true })`. 저장이 거절했을 칸은
 *    기록도 안 한다(목표 = 이 반의 목표 항목 허용 목록 · MP = EiE 반만 — `upsertGoal`·`saveMonthPlanCells`와
 *    같은 판정).
 * 🔴 '다른 강사 뷰'(열람 전용)면 기록도 없다 — perm-matrix 쓰기 캡이 위 게이트에서 이미 거절하지만,
 *    열람자의 기록이 남는 일이 없게 `readonlyTeacherViewError`를 **먼저** 본다(view-as-wiring 가드).
 * 🔑 새 값(`after`)은 **DB에서 다시 읽는다** — 클라가 보낸 새 값을 믿지 않는다(로그의 새 값이 DB와 달라지지
 *    않게). 이전 값(`before`)은 클라가 편집을 시작할 때 본 값이다(서버에 믿고 꺼낼 과거값이 없다 — lib 머리 ⚠️).
 * ⚠️ 반응속도: 클라는 이 액션을 기다리지 않는다(fire-and-forget). 그리고 게이트만 동기로 보고 **읽기·기록은
 *    응답 뒤(`after`)** 로 미룬다 — Next 서버 액션은 클라 호출이 순차라, 여기서 오래 붙잡으면 다음 자동저장이 밀린다.
 * ⚠️ 이 파일은 `"use server"`라 **async 함수만 export**한다([[#119]]).
 * ⚠️ `class_sheet_*`·`class_month_plan_cells`는 RLS 정책 0개 → admin + `tenant_id` 명시([[#104]]).
 */
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { logAction } from "@/features/audit/server/log";
import { mondayOf } from "@/features/timetable/lib/week";
import { goalAreasFor } from "../lib/goal-areas";
import { normalizePeriodStart } from "../lib/week";
import {
  auditValueChanged,
  clipAuditValue,
  GOAL_FIELD_LABEL,
  markFieldLabel,
  memoKeyLabel,
  MONTH_MEMO_LABEL,
  mpCellLabel,
  parseSheetEdits,
  type SheetEdit,
  type SheetEditCell,
} from "../lib/edit-audit";
import { requireEcsClassAccess, type EcsClassAccess } from "./access";

type Admin = ReturnType<typeof createAdminClient>;
/** DB의 지금 값 — 모르면(조회 실패·표 없음) `ok:false`로 **기록하지 않는다**(지어낸 새 값을 남기지 않는다). */
type Current = { ok: true; value: string | null } | { ok: false };

/** 학생 기록 칸 → 컬럼 — 저장 액션(`upsertStudentMark`의 `MARK_TEXT_COLUMNS`)과 같은 짝. */
const MARK_COLUMN = {
  status: "status",
  progressNote: "progress_note",
  score: "score",
  listeningLevel: "listening_level",
  memorizedWords: "memorized_words",
} as const;

const textOf = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function readCurrent(admin: Admin, access: EcsClassAccess, cell: SheetEditCell): Promise<Current> {
  const { tenantId, classId } = access;
  switch (cell.kind) {
    case "goal": {
      const { data, error } = await admin
        .from("class_sheet_goals")
        .select("textbook, target_progress")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("scope", cell.scope)
        .eq("period_start", normalizePeriodStart(cell.scope, cell.periodStart))
        .eq("role", cell.role)
        .eq("skill_area", cell.skillArea)
        .maybeSingle();
      if (error) return { ok: false };
      const row = data as { textbook: unknown; target_progress: unknown } | null;
      return { ok: true, value: textOf(cell.field === "textbook" ? row?.textbook : row?.target_progress) };
    }
    case "mark": {
      // `*` — 0202a·0206a 칸이 아직 없는 DB에서도 조회가 400으로 죽지 않게([[#95]]).
      const { data, error } = await admin
        .from("class_sheet_student_marks")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("student_id", cell.studentId)
        .eq("mark_date", cell.date)
        .eq("slot_start", cell.slotStart)
        .maybeSingle();
      if (error) return { ok: false };
      const row = data as Record<string, unknown> | null;
      return { ok: true, value: textOf(row?.[MARK_COLUMN[cell.field]]) };
    }
    case "memo": {
      const { data, error } = await admin
        .from("class_sheet_memos")
        .select("body")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("week_start", mondayOf(cell.weekStart))
        .eq("memo_key", cell.memoKey)
        .maybeSingle();
      if (error) return { ok: false };
      return { ok: true, value: textOf((data as { body: unknown } | null)?.body) };
    }
    case "monthMemo": {
      const { data, error } = await admin
        .from("class_sheet_month_memos")
        .select("body")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("month", `${cell.month}-01`)
        .maybeSingle();
      if (error) return { ok: false };
      return { ok: true, value: textOf((data as { body: unknown } | null)?.body) };
    }
    case "mpCell": {
      const { data, error } = await admin
        .from("class_month_plan_cells")
        .select("body")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("plan_date", cell.date)
        .eq("col_kind", cell.colKind)
        .maybeSingle();
      if (error) return { ok: false };
      return { ok: true, value: textOf((data as { body: unknown } | null)?.body) };
    }
  }
}

/** 칸 위치 + 한글 라벨 스냅샷 — 감사로그 뷰어(`describe.ts`)가 설정·폼 정의 없이 한글 한 줄을 만든다. */
function cellMetadata(cell: SheetEditCell, areaLabel: string | null): Record<string, unknown> {
  switch (cell.kind) {
    case "goal":
      return {
        kind: "goal",
        scope: cell.scope,
        periodStart: normalizePeriodStart(cell.scope, cell.periodStart),
        role: cell.role,
        skillArea: cell.skillArea,
        areaLabel,
        fieldLabel: GOAL_FIELD_LABEL[cell.field],
      };
    case "mark":
      return {
        kind: "mark",
        studentId: cell.studentId,
        date: cell.date,
        slotStart: cell.slotStart,
        field: cell.field,
        fieldLabel: markFieldLabel(cell.field),
      };
    case "memo":
      return {
        kind: "memo",
        weekStart: mondayOf(cell.weekStart),
        memoKey: cell.memoKey,
        fieldLabel: memoKeyLabel(cell.memoKey),
      };
    case "monthMemo":
      return { kind: "monthMemo", month: cell.month, fieldLabel: MONTH_MEMO_LABEL };
    case "mpCell":
      return { kind: "mpCell", date: cell.date, colKind: cell.colKind, fieldLabel: mpCellLabel(cell.colKind) };
  }
}

async function logSheetEdits(access: EcsClassAccess, edits: SheetEdit[]): Promise<void> {
  const areas = goalAreasFor(access.englishTrack, access.skillAreas);
  const admin = createAdminClient();
  await Promise.all(
    edits.map(async (edit) => {
      try {
        const { cell } = edit;
        // 🔴 저장 액션과 같은 허용 목록 — 저장이 거절했을 칸을 "바뀌었다"고 적지 않는다.
        if (cell.kind === "goal" && !areas.some((a) => a.key === cell.skillArea)) return;
        if (cell.kind === "mpCell" && access.englishTrack !== "eie") return;
        const cur = await readCurrent(admin, access, cell);
        if (!cur.ok || !auditValueChanged(edit.before, cur.value)) return;
        const areaLabel = cell.kind === "goal" ? (areas.find((a) => a.key === cell.skillArea)?.label ?? null) : null;
        await logAction({
          action:
            cell.kind === "goal"
              ? "ecs_goal_edit"
              : cell.kind === "mark"
                ? "ecs_mark_edit"
                : cell.kind === "mpCell"
                  ? "ecs_month_plan_edit"
                  : "ecs_memo_edit",
          targetType: "class_sheet",
          targetLabel: access.className,
          metadata: {
            classId: access.classId,
            ...cellMetadata(cell, areaLabel),
            before: clipAuditValue(edit.before),
            after: clipAuditValue(cur.value),
          },
        });
      } catch {
        // 감사 기록 실패는 편집을 막지 않는다(best-effort — logAction과 같은 규약).
      }
    }),
  );
}

/**
 * 칸을 떠난 편집을 기록한다 — 값이 실제로 바뀐 칸만 한 줄씩(판정은 DB 값으로).
 * 반환은 "받았다"뿐이다(기록은 응답 뒤) — 클라는 이 결과로 아무것도 하지 않는다.
 */
export async function commitSheetEdits(input: {
  classId: string;
  edits: SheetEdit[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const readonlyErr = await readonlyTeacherViewError();
  if (readonlyErr) return { ok: false, error: readonlyErr };
  const gate = await requireEcsClassAccess(String(input?.classId ?? ""), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const edits = parseSheetEdits(input?.edits);
  if (!edits) return { ok: false, error: "잘못된 요청입니다(편집 기록)" };
  const access = gate.access;
  after(() => logSheetEdits(access, edits));
  return { ok: true };
}
