"use server";

/**
 * 수학 시트(MCS) **학생 월간 목표 감사로그** — 칸을 떠날 때 한 줄(원장 결정 2026-09-14, 범위 확대).
 *
 * 종전엔 저장(`upsertStudentGoal`)이 **디바운스마다** 전후 값 없이 한 줄씩 남겼다. 이제 저장은 기록하지 않고,
 * 칸을 떠나면 여기로 온다. 규약(모양 검증·변동 판정·자르기)은 강사 시트와 한 벌([`class-sheets/lib/edit-audit.ts`]).
 *
 * 🔴 게이트 = 저장과 **같은 문**(`requireMcsClassAccess(write)`) + 열람 전용 가드를 **먼저**('다른 강사 뷰'에서
 *    기록이 남지 않게). 받는 칸 종류는 `MATH_EDIT_KINDS`뿐.
 * 🔑 새 값은 DB에서 다시 읽는다(로그의 새 값이 DB와 어긋나지 않게) · 이전 값은 화면이 보던 값이다.
 *    반환은 "받았다"뿐 — 읽기·기록은 응답 뒤(`after`)라 다음 자동저장을 붙잡지 않는다.
 * ⚠️ `"use server"` — async 함수만 export([[#119]]).
 */
import { after } from "next/server";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { logAction } from "@/features/audit/server/log";
import {
  auditValueChanged,
  clipAuditValue,
  GOAL_FIELD_LABEL,
  MATH_EDIT_KINDS,
  parseSheetEdits,
  type SheetEdit,
} from "@/features/class-sheets/lib/edit-audit";
import { requireMcsClassAccess } from "./access";

export async function commitMathGoalEdits(input: {
  classId: string;
  edits: SheetEdit[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const readonlyErr = await readonlyTeacherViewError();
  if (readonlyErr) return { ok: false, error: readonlyErr };
  const gate = await requireMcsClassAccess(String(input?.classId ?? ""), { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const edits = parseSheetEdits(input?.edits, MATH_EDIT_KINDS);
  if (!edits) return { ok: false, error: "잘못된 요청입니다(편집 기록)" };
  const access = gate.access;
  after(async () => {
    const admin = createAdminClient();
    // 🔴 저장(`upsertStudentGoal`)과 **같은 명단 확인**(tenant·반·학생의 수강 기록) — 안 거르면 이 반 쓰기 권한만으로
    //    남의 반 학생 id와 이전 값을 실어 "김OO · 목표 「X」 → (빈칸)" 같은 거짓 줄을 만들 수 있다(리뷰 2026-09-14).
    const studentIds = [...new Set(edits.flatMap((e) => (e.cell.kind === "mathGoal" ? [e.cell.studentId] : [])))];
    if (studentIds.length === 0) return;
    // 한 요청은 ≤ SHEET_EDIT_BATCH_MAX(20)명이라 단일 `.in`으로 충분하다.
    const { data: enr, error: enrErr } = await admin
      .from("enrollments")
      .select("student_id")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", access.classId)
      .in("student_id", studentIds);
    if (enrErr) return;
    const inClass = new Set((enr ?? []).map((r) => String((r as { student_id: unknown }).student_id)));
    await Promise.all(
      edits.map(async ({ cell, before }) => {
        if (cell.kind !== "mathGoal") return;
        if (!inClass.has(cell.studentId)) return;
        try {
          const { data, error } = await admin
            .from("math_month_goals")
            .select("textbook, target_progress")
            .eq("tenant_id", access.tenantId)
            .eq("class_id", access.classId)
            .eq("student_id", cell.studentId)
            .eq("period_start", monthRange(cell.month).from)
            .maybeSingle();
          if (error) return;
          const row = data as { textbook: unknown; target_progress: unknown } | null;
          const raw = cell.field === "textbook" ? row?.textbook : row?.target_progress;
          const nextValue = typeof raw === "string" ? raw : null;
          if (!auditValueChanged(before, nextValue)) return;
          await logAction({
            action: "mcs_goal_edit",
            targetType: "class",
            targetLabel: access.className,
            metadata: {
              classId: access.classId,
              kind: "mathGoal",
              studentId: cell.studentId,
              month: cell.month,
              field: cell.field,
              fieldLabel: GOAL_FIELD_LABEL[cell.field],
              before: clipAuditValue(before),
              after: clipAuditValue(nextValue),
            },
          });
        } catch {
          // 감사 기록 실패는 편집을 막지 않는다(best-effort).
        }
      }),
    );
  });
  return { ok: true };
}
