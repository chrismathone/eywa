"use server";
/**
 * 학부모 결석 통보 **접수** — 데스크가 전화를 받은 그 자리에서 결석·사유를 한 번에 남긴다.
 *
 * 원장 2026-08-19: *"데스크에서 학부모 연락을 받으면 결석처리 진행하고, 결석처리된 학생에 대해 모든 곳에서
 * 자동으로 결석 배선이 연결되어 담임이 이중 결석처리하지 않도록. 메모도 마찬가지."*
 *
 * 🔴 **저장은 기존 액션(`setAttendanceCell`)을 그대로 통과한다** — 여기서 `attendance_records`에 직접
 *    쓰지 않는다. 그 액션이 저장 축(교시/그날 전체)·행 승격·시수 보존·알림 훅을 전부 갖고 있어서,
 *    우회하면 같은 규칙을 두 벌로 관리하게 되고 그 순간 돈(시수·회차)이 갈린다.
 * 🔴 **덮어쓰지 않는다**: 이미 출석·지각·조퇴·보강으로 찍힌 칸은 **건너뛰고 화면에 사유를 돌려준다**.
 *    학부모 말과 강사 기록이 다투는 자리라 시스템이 조용히 한쪽으로 정하면 안 된다.
 *    이미 결석인 칸은 **메모만** 덧붙인다(상태·시수 불변 = 급여·출석률 불변).
 * ⚠️ 접수는 **사무실(full)만**이다(`canManageTenant`) — 남의 반 칸까지 한 번에 만드는 조작이라
 *    "내 담당"이라는 개념이 성립하지 않는다(perm-matrix 주석의 판정 기준). 강사는 자기 반 칸을
 *    출석부·ECS·원스크린에서 종전대로 찍는다.
 * ⚠️ **기존 결석 벨(`attendance_absent_desk`)은 일부러 막지 않는다.** 오늘·어제 건이면 출결 알림 토글을
 *    켠 계정(차량·셔틀 포함)에 "결석" 벨이 그대로 간다 — 그 팀에겐 "오늘 이 아이는 안 온다"가 필요한
 *    정보다. 문구가 "학부모 확인이 필요합니다"라 재확인 전화로 이어질 수 있지만, 벨을 눌러 들어가는
 *    당일 큐에서는 이 접수가 **처리됨**으로 보인다(아래 D 단계). 미래 날짜 접수는 그 벨 자체가 안 간다.
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { appendMemo, hasMemoLine } from "@/features/onescreen/makeup-absence-link";
import { setAttendanceCell } from "../../server/actions";
import { recordFollowup } from "../../live/server/actions";
import { INTAKE_MAX_REASON, intakeMemo } from "../absence-intake";
import { loadIntakePreview, type IntakePreview } from "./queries";
import { notifyTeachersOfIntake } from "./notify";

/** 접수가 손대지 않는 상태 — "이미 왔다/보강했다"는 기록은 전화 한 통으로 뒤집을 값이 아니다. */
const KEEP_STATUSES = new Set(["present", "late", "early_leave", "makeup"]);

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  late: "지각",
  early_leave: "조퇴",
  makeup: "보강",
  absent: "결석",
  excused: "공결",
};

export type IntakeSkip = { className: string; date: string; statusLabel: string };

export type IntakeSaveResult =
  | {
      ok: true;
      /** 새로 결석으로 찍은 칸 수. */
      saved: number;
      /** 이미 결석이라 메모만 덧붙인 칸 수. */
      noted: number;
      /** 출석·지각·보강이라 손대지 않은 칸 — 화면이 사유를 그대로 보여준다. */
      skipped: IntakeSkip[];
      /**
       * 저장이 **실패한** 칸 — 한 칸이 실패해도 나머지는 계속 쓴다.
       * 🔴 중간에 통째로 중단하면 이미 쓴 칸은 남고 데스크는 "몇 칸이 들어갔는지" 모른 채 다시 접수한다.
       *    실패는 조용히 삼키지 않고 칸 단위로 돌려준다([[#89]] — 삼켜지는 실패 경로를 따로 드러낼 것).
       */
      failed: { className: string; date: string; message: string }[];
      /**
       * 출결은 저장됐지만 **당일 큐 '처리됨' 표시**(후속조치 기록)를 못 남겼다 — 그날 데스크 큐가
       * 이 결석을 '확인 필요'로 다시 올린다. 화면이 알려 줘야 데스크가 큐에서 직접 매듭짓는다.
       */
      queueMarkFailed: boolean;
    }
  | { error: string };

/** 학생 검색 — 접수 다이얼로그 전용(전 학원). 게이트는 접수와 같은 사무실 권한이다(#77). */
export async function searchIntakeStudents(
  query: string,
): Promise<{ id: string; name: string; label: string }[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!(await canManageTenant(user.systemRole, "attendance"))) return [];
  const q = query.trim();
  if (!q) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, school")
    .neq("status", "withdrawn")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(20);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    label: schoolGradeLabel((s.school as string | null) ?? null, (s.grade as string | null) ?? null),
  }));
}

/** 미리보기 — 저장 전에 "어느 반 몇 칸"을 보여준다. 조회지만 다이얼로그가 클라라 액션으로 노출한다. */
export async function previewAbsenceIntake(input: {
  studentId: string;
  from: string;
  to: string;
}): Promise<IntakePreview> {
  const user = await getCurrentUser();
  if (!user) return { student: null, cells: [], error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "attendance"))) {
    return { student: null, cells: [], error: "결석 접수 권한이 없습니다" };
  }
  // 조회 헬퍼는 규약상 throw한다(B3) — 다이얼로그가 빈 목록에 갇히지 않게 한글 사유로 접는다.
  try {
    return await loadIntakePreview(input);
  } catch {
    return { student: null, cells: [], error: "대상 수업을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  }
}

export async function recordAbsenceIntake(input: {
  studentId: string;
  from: string;
  to: string;
  /** 학부모가 말한 사유 — 그대로 출결 메모가 된다(모든 화면이 이 한 줄을 읽는다). */
  reason: string;
  /** 화면에서 체크를 푼 칸(cellKey) — **빼는 데만** 쓴다. 목록은 서버가 다시 계산한다. */
  exclude?: string[];
}): Promise<IntakeSaveResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "attendance"))) return { error: "결석 접수 권한이 없습니다" };

  const reason = input.reason.trim().slice(0, INTAKE_MAX_REASON);
  if (!reason) return { error: "사유를 입력해 주세요 — 이 문장이 출석부 메모가 됩니다" };
  // 메모는 사유 + 출처 한 줄 — 담임이 어느 화면에서 보든 "데스크가 처리했다"가 함께 간다(intakeMemo 주석).
  const memoLine = intakeMemo(reason);

  // 🔴 화면이 준 칸 목록을 믿지 않는다 — 같은 규칙으로 서버가 다시 계산하고, 클라는 '빼기'만 할 수 있다.
  // 조회가 실패하면 **아무것도 쓰지 않는다**(모르면 안 찍는다 — 잘못된 칸에 결석을 만드는 것보다 낫다).
  let preview: IntakePreview;
  try {
    preview = await loadIntakePreview({ studentId: input.studentId, from: input.from, to: input.to });
  } catch {
    return { error: "대상 수업을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  if (preview.error) return { error: preview.error };
  const student = preview.student;
  if (!student) return { error: "학생을 찾을 수 없습니다" };
  const excluded = new Set(input.exclude ?? []);
  const targets = preview.cells.filter((c) => !excluded.has(c.key));
  if (targets.length === 0) return { error: "접수할 수업이 없습니다 — 그 기간에 이 학생 수업이 없습니다" };

  let saved = 0;
  let noted = 0;
  const skipped: IntakeSkip[] = [];
  const failed: { className: string; date: string; message: string }[] = [];
  const written: { classId: string; className: string; date: string }[] = [];

  /** 칸 하나 처리 결과 — 집계는 호출부가 순서대로 접는다(병렬 실행이라 안에서 누적하지 않는다). */
  type CellOutcome = {
    written?: { classId: string; className: string; date: string };
    saved?: boolean;
    noted?: boolean;
    skip?: IntakeSkip;
    fail?: { className: string; date: string; message: string };
  };

  async function applyCell(cell: (typeof targets)[number]): Promise<CellOutcome> {
    const existing = cell.existing;
    const where = { className: cell.className, date: cell.date };
    if (existing && KEEP_STATUSES.has(existing.status)) {
      return { skip: { ...where, statusLabel: STATUS_LABEL[existing.status] ?? "기록 있음" } };
    }

    if (existing?.status === "absent") {
      // 이미 결석 — 상태·시수는 손대지 않고 **메모만** 덧붙인다(멱등: 같은 줄은 두 번 쌓이지 않는다).
      if (hasMemoLine(existing.note, memoLine)) return { written: { ...where, classId: cell.classId } };
      const res = await setAttendanceCell({
        studentId: input.studentId,
        classId: cell.classId,
        sessionDate: cell.date,
        status: null,
        noteOnly: true,
        // 🔴 **그 기록이 실제로 가진 교시**로 좁힌다(칸의 저장 축이 아니라). 영어 칸은 교시 축인데
        //    옛 "그날 전체"(slot null) 행이 남아 있을 수 있고, 그 행을 교시로 조회하면 0건이라
        //    메모 저장이 "출결 기록이 없다"로 실패한다(실측 규약: 두 세대가 공존한다).
        note: appendMemo(existing.note, memoLine),
        slotStart: existing.slotStart,
        periodStart: cell.periodStart,
        quiet: true,
      });
      if ("error" in res) return { fail: { ...where, message: res.error } };
      return { noted: true, written: { ...where, classId: cell.classId } };
    }

    // 빈 칸 — 결석 + 사유. `onlyIfEmpty`로 **미리보기와 저장 사이에 생긴 남의 기록**을 덮지 않는다
    // (그 사이 강사가 출석을 찍었을 수 있다 — 화면 스냅샷은 게이트가 아니다).
    const res = await setAttendanceCell({
      studentId: input.studentId,
      classId: cell.classId,
      sessionDate: cell.date,
      status: "absent",
      note: memoLine,
      slotStart: cell.saveSlot,
      periodStart: cell.periodStart,
      onlyIfEmpty: true,
      quiet: true,
    });
    if ("error" in res) return { fail: { ...where, message: res.error } };
    if (res.conflict) {
      return { skip: { ...where, statusLabel: STATUS_LABEL[res.conflict.status] ?? "기록 있음" } };
    }
    return { saved: true, written: { ...where, classId: cell.classId } };
  }

  /**
   * 🔴 **같은 (반·날짜)는 반드시 순차**다 — 영어는 한 반이 하루 3교시라 칸이 셋인데, 그 칸들이 동시에
   *    저장되면 옛 "그날 전체" 행을 두 교시가 같이 **승격**하려 들어(save-targets) 한쪽이 조용히 덮인다.
   *    반·날짜가 다른 그룹끼리는 건드리는 행이 겹치지 않아 병렬이 안전하다.
   * ⚠️ 순차 일변도로 두면 최대 60칸 × (조회+쓰기)가 함수 시간제한을 위협한다(칸당 왕복 여러 번).
   */
  const groups = new Map<string, typeof targets>();
  for (const cell of targets) {
    const key = `${cell.classId}|${cell.date}`;
    const list = groups.get(key);
    if (list) list.push(cell);
    else groups.set(key, [cell]);
  }
  const groupList = [...groups.values()];
  const CONCURRENCY = 4;
  const outcomes: CellOutcome[] = [];
  for (let i = 0; i < groupList.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      groupList.slice(i, i + CONCURRENCY).map(async (group) => {
        const out: CellOutcome[] = [];
        for (const cell of group) out.push(await applyCell(cell));
        return out;
      }),
    );
    outcomes.push(...batch.flat());
  }

  for (const o of outcomes) {
    if (o.saved) saved += 1;
    if (o.noted) noted += 1;
    if (o.skip) skipped.push(o.skip);
    if (o.fail) failed.push(o.fail);
    if (o.written) written.push(o.written);
  }

  if (written.length === 0) return { ok: true, saved, noted, skipped, failed, queueMarkFailed: false };

  // D — 그날 데스크 확인 큐에서 **이미 처리됨**으로 뜨게 한다. 안 그러면 데스크가 같은 건에 재확인
  // 전화를 건다(미리 찍은 결석은 그날 레인 B에 '결석 = 즉시 연락 대상'으로 다시 올라온다).
  // 날짜마다 한 건, 교시는 null("그날 전체") — 큐 조회가 교시 없는 조치를 모든 교시에 붙인다.
  const firstClassOfDate = new Map<string, string>();
  for (const w of written) if (!firstClassOfDate.has(w.date)) firstClassOfDate.set(w.date, w.classId);
  let queueMarkFailed = false;
  for (const [date, classId] of firstClassOfDate) {
    const fu = await recordFollowup({
      studentId: input.studentId,
      classId,
      sessionDate: date,
      slotStart: null,
      signal: "absent",
      state: "resolved",
      outcome: "absent_today",
      contactedVia: "phone",
      note: reason,
      allowFuture: true,
    });
    // 표가 없거나(0210a 미적용) 저장이 실패하면 큐가 이 결석을 다시 '확인 필요'로 올린다 — 알려야 한다.
    if ("error" in fu) queueMarkFailed = true;
  }

  // B — 담당 강사 벨(수신자마다 자기 반 링크). best-effort라 실패해도 접수는 성사된 것으로 둔다.
  after(() =>
    notifyTeachersOfIntake({
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.displayName ?? null,
      studentId: input.studentId,
      studentName: student.name,
      cells: written,
      reason,
    }),
  );

  revalidatePath("/attendance");
  revalidatePath("/attendance/live");
  revalidatePath("/ecs");
  revalidatePath("/onescreen");
  return { ok: true, saved, noted, skipped, failed, queueMarkFailed };
}
