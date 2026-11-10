"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { isValidYmd, kstToday, resolveReportDate } from "@/lib/date-kst";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { addMakeupSessionEntries, hasMakeupSessionEntry, type MakeupSessionEntry } from "../makeup-session";
import { changeMakeupSession } from "./makeup-session-store";
import { makeupDeadlineError } from "@/features/attendance/server/makeup-deadline-gate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { acceptMakeupAnchor, MAKEUP_ANCHOR_REQUIRED_ERROR } from "../makeup-anchor";
import { classRouteActive, SEND_CLASS_SUBJECTS } from "../send-class";
import { loadMakeupAnchorCandidates, syncAnchorCells } from "./makeup-anchor-sync";
import { makeupMemo } from "../makeup-absence-link";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { logAction } from "@/features/audit/server/log";
import { mergeEffectNotice, type MakeupEffectNotice } from "@/features/makeups/server/adapters/effects";

/**
 * 확인창 한 줄 — 세션 항목 + **지금 출석부 칸을 세울지**(`recordCell`).
 * `recordCell` = 정규 수업에 기록하지 않는 보강(합칠 후보 없음 · 그 반에 오늘 정규 줄 없음)일 때 화면이 켠다 — 옛 `persistAnchorMakeup`과
 * 같은 조건. 후보 반에 시수를 얹는 분리 보강은 화면이 그 칸에 직접 얹으므로 끈다(두 번 세지 않게).
 */
type MakeupRegisterEntry = MakeupSessionEntry & { recordCell?: boolean };

/**
 * 확인 버튼은 이 저장이 끝난 뒤에만 성공한다. 보고서 생성·발송은 하지 않는다.
 *
 * 🔴 **보강 칸은 확인하는 순간 앵커 반에 선다**(적대 리뷰 2026-09-30 — 보강 시수 유실 방지). 칸을 보고서 저장 때로만 미루면
 *    보고서를 안 쓰는 보강(영어·보고서를 잊은 날)·저장 실패의 시수가 급여·수납에서 사라진다. 옛 `persistAnchorMakeup`은 화면이 기다리지 않고
 *    적어 실패가 다른 반으로 샜다(C2) — 이제는 **서버가 같은 앵커·같은 함수**(`syncAnchorCells`, 보고서 저장 훅과 한 벌)로 기다려서 적는다.
 *    보고서 저장 훅은 이미 선 칸을 건드리지 않는다(있으면 그대로). 대신 보강이면 귀속(`taught_by`)도 함께 적는다.
 * ⚠️ 칸 쓰기 실패는 명단 등록을 되돌리지 않는다 — `cellError`로 알리고, 보고서 저장 훅이 같은 반에 다시 세운다.
 */
export async function registerMakeupEntries(input: {
  studentId: string; date: string; entries: MakeupRegisterEntry[];
}): Promise<
  | { ok: true; updatedAt: string; previousUpdatedAt: string | null; cellError?: string; makeupEffect?: MakeupEffectNotice }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  if (!input.studentId || !isValidYmd(input.date) || resolveReportDate(input.date) !== input.date || !input.entries.length || input.entries.length > 20) {
    return { ok: false, error: "보강 날짜와 과목을 확인해 주세요" };
  }
  const supabase = await createClient();
  const [student, classes, cands] = await Promise.all([
    supabase.from("students").select("id").eq("tenant_id", user.tenantId).eq("id", input.studentId).maybeSingle(),
    getTeachingClasses(supabase, user.id, input.date),
    // 앵커 후보 = 담당 반 ∪ 학생이 다니는 반(원장 결정 2 — 대신 보강은 학생의 원래 반). 보고서 저장·반 바꾸기와 같은 재료.
    loadMakeupAnchorCandidates(supabase, { tenantId: user.tenantId, userId: user.id, studentId: input.studentId, date: input.date }).catch(() => null),
  ]);
  if (student.error || !student.data) return { ok: false, error: "학원 학생을 확인하지 못했습니다" };
  if (!cands) return { ok: false, error: "보강 수업 후보를 확인하지 못했습니다 — 다시 시도해 주세요" };
  const settings = await getTenantSettings();
  const entries: MakeupSessionEntry[] = [];
  /** 지금 칸을 세울 줄(과목 → 앵커·시수·결석분) — 세션에 **새로 들어간** 줄만 실제로 쓴다(아래). */
  const cellWanted = new Map<string, { anchor: string; units: number | null; absentDate: string | null }>();
  for (const { recordCell, ...entry } of input.entries) {
    // 앵커 = (담당 반 ∪ 학생이 다니는 반) · 같은 과목 · 종강 전(`acceptMakeupAnchor` — 선택지·보고서 저장·반 바꾸기와 같은 판정).
    const anchor = acceptMakeupAnchor(cands, entry.makeupClassId, entry.subject, input.date);
    if (!classes.some(c => c.subject === entry.subject) || (entry.makeupClassId && !anchor)) {
      return { ok: false, error: "담당 과목과 보강 수업을 확인해 주세요" };
    }
    // 🔴 반별 발송 대상(수학 · ClassNote 반 경로)은 반 없이 추가할 수 없다('반 미정' 보강을 만들지 않는다 — 원장 2026-09-30).
    if (!anchor && SEND_CLASS_SUBJECTS.has(entry.subject) && classRouteActive(settings)) {
      return { ok: false, error: MAKEUP_ANCHOR_REQUIRED_ERROR };
    }
    if (entry.units != null && (!Number.isFinite(entry.units) || entry.units <= 0 || entry.units > 24)) {
      return { ok: false, error: "보강 시수를 확인해 주세요" };
    }
    if (entry.absentDate && !isValidYmd(entry.absentDate)) {
      return { ok: false, error: "결석 날짜를 확인해 주세요" };
    }
    // 보강 기한(결석한 달의 다음 달 말일, 강사뷰) — 결석분 연결 문들과 같은 판정(makeup-deadline-gate.ts).
    const deadlineError = entry.absentDate ? await makeupDeadlineError(entry.absentDate, input.date) : null;
    if (deadlineError) return { ok: false, error: deadlineError };
    entries.push({ ...entry, makeupClassId: anchor?.id ?? null, makeupClassName: anchor?.className ?? null });
    if (recordCell && anchor) cellWanted.set(entry.subject, { anchor: anchor.id, units: entry.units ?? null, absentDate: entry.absentDate ?? null });
  }
  // 세션에 **새로 들어간** 과목(이미 있던 줄은 `addMakeupSessionEntries`가 덮지 않는다 — 그 줄의 칸은 처음 등록 때 섰다).
  let added = new Set<string>();
  const saved = await changeMakeupSession(supabase, {
    tenantId: user.tenantId, teacherId: user.id, studentId: input.studentId, date: input.date,
  }, (progress) => {
    added = new Set(entries.filter((e) => !hasMakeupSessionEntry(progress, e.subject)).map((e) => e.subject));
    return addMakeupSessionEntries(progress, entries);
  });
  if (!saved.ok || cellWanted.size === 0) return saved;
  // 칸 쓰기 게이트 — 출결 쓰기 권한 · 강사는 출결 수정 기간(옛 즉시 쓰기 `setAttendanceCell`과 같은 선). 막히면 칸은 보고서 저장 훅이 세운다.
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return saved;
  if ((await attendanceWindowApplies(user.systemRole)) && !isWithinAttendanceEditWindow(input.date, kstToday())) return saved;
  const errors: string[] = [];
  // 칸은 섰지만 보강 기록 반영이 남은 경우 — 명단 등록도 출결도 되돌리지 않고 알리기만 한다.
  let makeupEffect: MakeupEffectNotice | null = null;
  for (const [subject, want] of cellWanted) {
    if (!added.has(subject)) continue;
    const r = await syncAnchorCells({
      tenantId: user.tenantId,
      studentId: input.studentId,
      date: input.date,
      anchor: want.anchor,
      ownerId: user.id,
      move: null,
      units: want.units,
      note: want.absentDate ? makeupMemo(want.absentDate, input.date) : null,
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) {
      errors.push(r.error);
      continue;
    }
    makeupEffect = mergeEffectNotice(makeupEffect, r.makeupEffect);
    // 출결을 새로 세웠으면 감사로그 — 옛 즉시 쓰기(`setAttendanceCell`)가 남기던 것과 같은 액션 키(기능 추가·변동은 모두 감사로그).
    if (r.created)
      await logAction({
        action: "attendance_cell",
        targetType: "attendance",
        metadata: {
          studentId: input.studentId,
          classId: want.anchor,
          date: input.date,
          status: "makeup",
          ...(want.units != null && want.units !== 1 ? { units: want.units } : {}),
          via: "makeup_register",
        },
      });
  }
  return { ...saved, ...(errors.length ? { cellError: errors[0] } : {}), ...(makeupEffect ? { makeupEffect } : {}) };
}
