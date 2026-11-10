import "server-only";

/**
 * 보강 보고서의 **반 바꾸기·후보** — 서버 한 벌(원장 2026-09-30 *"보고서 반 = 출석부 반은 모든 곳에서 일치"*).
 * 불변식·규칙은 순수부 [`makeup-anchor.ts`](../makeup-anchor.ts). 칸 쓰기는 [`makeup-anchor-cells.ts`](@/features/attendance/server/makeup-anchor-cells).
 *
 * 🔴 반을 바꾸는 문은 **`changeMakeupAnchor` 하나**다 — 보고서의 `makeup_class_id`·`classnote_class_id`와 출결 칸을 **함께** 옮긴다.
 *    발송 다이얼로그·관리자 반 고르기·출석부 쪽 이동은 `classnote_class_id`를 직접 쓰지 않는다.
 * ⚠️ 이 파일은 `"use server"`가 아니다(동기 헬퍼·타입을 export 한다 — [[#119]]). 액션은 `makeup-class-actions.ts`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { findMakeupPoolClass } from "@/features/attendance/server/makeup-pool";
import {
  applyAnchorMove,
  ensureMakeupAnchorCell,
  ownerTeachesClassOn,
  planAnchorMove,
} from "@/features/attendance/server/makeup-anchor-cells";
import {
  acceptMakeupAnchor,
  makeupAnchorLockedReason,
  MAKEUP_ANCHOR_REJECTED_ERROR,
  MAKEUP_ANCHOR_REQUIRED_ERROR,
  MOVE_BLOCKED_MESSAGE,
  substituteTaughtBy,
  type AnchorCandidate,
  type MoveCellsPlan,
} from "../makeup-anchor";
import { makeupMemo } from "../makeup-absence-link";
import { makeupSessionEntries } from "../makeup-session";
import { logAction } from "@/features/audit/server/log";
import type { MakeupEffectNotice } from "@/features/makeups/server/adapters/effects";
import { explainDbError } from "@/lib/supabase/db-error";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 보강 앵커 **후보**(원장 결정 2) — 작성 강사의 그날 담당 반(담임 ∪ 위임) ∪ 그날 그 학생이 다니는 반.
 * 종강·과목 판정은 받는 쪽(`acceptMakeupAnchor`)이 한다(목록은 재료만 싣는다 — 선택지 화면도 같은 재료).
 * @param supabase 작성 강사 세션(담당 반 판정은 원스크린 명단과 **같은 함수**) · 학생 수강·반 정보는 admin + tenant 필터.
 * 조회 실패는 throw(호출부가 저장·등록을 거절한다 — 모르는 반을 받지 않는다).
 */
export async function loadMakeupAnchorCandidates(
  supabase: ServerClient,
  input: { tenantId: string; userId: string; studentId: string; date: string },
): Promise<AnchorCandidate[]> {
  const admin = createAdminClient();
  const [teaching, enr] = await Promise.all([
    getTeachingClasses(supabase, input.userId, input.date),
    admin
      .from("enrollments")
      .select("class_id, start_date, end_date, is_transferred, on_hold")
      .eq("tenant_id", input.tenantId)
      .eq("student_id", input.studentId),
  ]);
  if (enr.error) throw new Error(enr.error.message);
  // 🔴 종료 규약 단일 소스([[#125]]) — 반이동 당일 옛 반은 이미 아니다. 휴원(on_hold)은 다니는 반이 아니다(선택지와 같은 기준).
  const enrolled = new Set(
    (enr.data ?? [])
      .filter(
        (e) =>
          !e.on_hold &&
          (!e.start_date || (e.start_date as string) <= input.date) &&
          !isEnrollmentEndedOn((e.end_date as string | null) ?? null, input.date, !!e.is_transferred),
      )
      .map((e) => e.class_id as string),
  );
  const mine = new Map(teaching.map((c) => [c.id, c]));
  const out = new Map<string, AnchorCandidate>();
  for (const c of teaching)
    out.set(c.id, { id: c.id, className: c.className, subject: c.subject, closedAt: c.closedAt ?? null, mine: true, enrolled: enrolled.has(c.id) });
  const extra = [...enrolled].filter((id) => !mine.has(id));
  if (extra.length) {
    const { data, error } = await admin
      .from("classes")
      .select("id, class_name, subject, closed_at")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true)
      .in("id", extra.slice(0, 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? [])
      out.set(c.id as string, {
        id: c.id as string,
        className: (c.class_name as string) ?? "",
        subject: c.subject as string,
        closedAt: (c.closed_at as string | null) ?? null,
        mine: false,
        enrolled: true,
      });
  }
  return [...out.values()];
}

/** 보강 보고서 한 행 — 반 바꾸기 재료(조회 결과 모양). */
export type MakeupReportRow = {
  id: string;
  studentId: string;
  reportDate: string;
  subject: string | null;
  makeupClassId: string | null;
  classnoteStatus: string | null;
  classnoteSentAt: string | null;
  /** 소유 강사(보강 반의 주인·귀속) — 저장된 행의 `created_by`. */
  ownerId: string | null;
};

/**
 * 옛 자리 → 새 반 **칸 이동 계획**(읽기만). 옛 자리 = 옛 앵커 반, 앵커가 없던 행이면 소유 강사의 보이지 않는 보강 반.
 * 막히면 `{ error }`(한국어) — 호출부는 **보고서를 바꾸기 전에** 부른다.
 */
export async function planReportAnchorMove(input: {
  tenantId: string;
  studentId: string;
  date: string;
  prevAnchor: string | null;
  ownerId: string | null;
  toClassId: string;
}): Promise<{ plan: MoveCellsPlan; fromClassId: string | null } | { error: string }> {
  try {
    const pool = input.prevAnchor ? null : input.ownerId ? await findMakeupPoolClass(input.tenantId, input.ownerId) : null;
    const fromClassId = input.prevAnchor ?? pool;
    const plan = await planAnchorMove({
      tenantId: input.tenantId,
      studentId: input.studentId,
      date: input.date,
      fromClassId,
      fromIsPool: !input.prevAnchor,
      toClassId: input.toClassId,
    });
    if (plan.kind === "blocked") return { error: MOVE_BLOCKED_MESSAGE[plan.reason] };
    return { plan, fromClassId };
  } catch {
    return { error: "출석부 칸을 확인하지 못했습니다 — 다시 시도해 주세요" };
  }
}

/**
 * 앵커 반에 칸을 **맞춘다** — 계획된 이동을 하고(있으면), 그래도 칸이 없으면 새로 세운다. 대신 보강 귀속을 함께 적는다.
 * 보고서 저장 훅(`saveLessonReport`)·반 바꾸기(`changeMakeupAnchor`)·관리자 작성 발송이 같은 함수를 쓴다.
 */
export async function syncAnchorCells(input: {
  tenantId: string;
  studentId: string;
  date: string;
  anchor: string;
  ownerId: string | null;
  move: { plan: MoveCellsPlan; fromClassId: string | null } | null;
  units?: number | null;
  note?: string | null;
}): Promise<{ ok: true; moved: number; created: boolean; makeupEffect?: MakeupEffectNotice } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const mine = input.ownerId
    ? await ownerTeachesClassOn(admin, { tenantId: input.tenantId, ownerId: input.ownerId, classId: input.anchor, date: input.date })
    : true;
  const taughtBy = substituteTaughtBy(input.ownerId, mine);
  let moved = 0;
  if (input.move?.plan.kind === "move" && input.move.fromClassId) {
    const r = await applyAnchorMove({
      tenantId: input.tenantId,
      ids: input.move.plan.ids,
      fromClassId: input.move.fromClassId,
      toClassId: input.anchor,
      studentId: input.studentId,
      date: input.date,
      taughtBy,
      ownerId: input.ownerId,
    });
    if (!r.ok) return r;
    moved = r.moved;
    // 옮긴 칸이 곧 앵커 반의 칸이다 — 여기서 '세우기' 조회가 실패해 오류를 돌려주면 호출부가 보고서만 되돌려 칸과 갈린다(적대 리뷰 2026-09-30).
    if (moved > 0 && r.makeupEffect) return { ok: true, moved, created: false, makeupEffect: r.makeupEffect };
    if (moved > 0) return { ok: true, moved, created: false };
  }
  const ensured = await ensureMakeupAnchorCell({
    tenantId: input.tenantId,
    studentId: input.studentId,
    date: input.date,
    classId: input.anchor,
    recordedBy: input.ownerId,
    taughtBy,
    units: input.units ?? null,
    note: input.note ?? null,
  });
  if (!ensured.ok) return ensured;
  return { ok: true, moved, created: ensured.created, ...(ensured.makeupEffect ? { makeupEffect: ensured.makeupEffect } : {}) };
}

/**
 * **보강 반 바꾸기의 단일 문** — 보고서 `makeup_class_id`·`classnote_class_id`를 새 반으로(조건부) + 출결 칸을 옮긴다.
 * 순서: 잠금 확인 → 칸 이동 계획(막히면 아무것도 안 바꾼다) → 보고서 조건부 갱신 → 칸 이동·세우기(실패하면 보고서를 되돌린다).
 * 🔴 게시된 행(`classnote_sent_at`)·게시 중·회수 중은 거절한다 — 회수는 옛 반 기록으로 글을 찾는다.
 * ⚠️ 권한·앵커 수용(`acceptMakeupAnchor`)은 호출부가 먼저 본다(같은 판정이 호출부마다 다른 사람 기준이라서 — 강사는 자기 담당,
 *    관리자는 학생 수강 반).
 */
export async function changeMakeupAnchor(input: {
  tenantId: string;
  report: MakeupReportRow;
  toClassId: string;
}): Promise<{ ok: true; moved: number; created: boolean; unchanged?: boolean } | { ok: false; error: string }> {
  const r = input.report;
  const locked = makeupAnchorLockedReason({ classnoteStatus: r.classnoteStatus, classnoteSentAt: r.classnoteSentAt });
  if (locked) return { ok: false, error: locked };
  const move = await planReportAnchorMove({
    tenantId: input.tenantId,
    studentId: r.studentId,
    date: r.reportDate,
    prevAnchor: r.makeupClassId,
    ownerId: r.ownerId,
    toClassId: input.toClassId,
  });
  if ("error" in move) return { ok: false, error: move.error };
  const admin = createAdminClient();
  const unchanged = r.makeupClassId === input.toClassId;
  if (!unchanged) {
    // 조건부 한 문 — 읽은 앵커 그대로 · 게시 기록 없음 · 워커가 집지 않음. 그새 바뀌었으면 0행.
    let q = admin
      .from("lesson_reports")
      .update({ makeup_class_id: input.toClassId, classnote_class_id: input.toClassId })
      .eq("tenant_id", input.tenantId)
      .eq("id", r.id)
      .is("classnote_sent_at", null)
      .or("classnote_status.is.null,classnote_status.not.in.(processing,success,recall_requested,recalling)");
    q = r.makeupClassId ? q.eq("makeup_class_id", r.makeupClassId) : q.is("makeup_class_id", null);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: explainDbError(error, { scope: "onescreen.makeup-anchor-sync.changeMakeupAnchor", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    if (!data?.length) return { ok: false, error: "보고서가 그새 바뀌었습니다 — 새로고침 뒤 다시 시도해 주세요" };
  }
  const synced = await syncAnchorCells({
    tenantId: input.tenantId,
    studentId: r.studentId,
    date: r.reportDate,
    anchor: input.toClassId,
    ownerId: r.ownerId,
    move: move,
  });
  if (!synced.ok) {
    if (!unchanged) {
      // 칸을 못 옮겼으면 보고서도 되돌린다 — 둘이 갈린 채로 두지 않는다(되돌리기 실패는 드라이런이 센다).
      await admin
        .from("lesson_reports")
        .update({ makeup_class_id: r.makeupClassId, classnote_class_id: r.makeupClassId })
        .eq("tenant_id", input.tenantId)
        .eq("id", r.id)
        .eq("makeup_class_id", input.toClassId)
        .is("classnote_sent_at", null);
    }
    return { ok: false, error: `출석부 칸을 옮기지 못해 반을 바꾸지 않았습니다 — ${synced.error}` };
  }
  return { ok: true, moved: synced.moved, created: synced.created, ...(unchanged ? { unchanged: true } : {}) };
}

/**
 * **이미 있는 보강 보고서의 반이 저장으로 바뀔 때** — upsert **전에** 조건부 한 문장으로 먼저 바꾼다(적대 리뷰 2026-09-30).
 * 저장은 옛 행을 먼저 읽고(잠금 판정) 한참 뒤 upsert 한다 — 그 사이 워커가 `queued` 행을 집으면(`processing`) 워커는 **옛 반**으로
 * 게시하는데 upsert는 새 반을 적어 게시 반 ≠ 보고서 반이 된다. `changeMakeupAnchor`와 같은 조건(읽은 앵커 그대로 · 게시 기록 없음 ·
 * 워커가 집지 않음 · 회수 중 아님)이라 둘 중 하나만 이긴다(0행이면 저장을 멈춘다). 뒤따르는 upsert는 같은 값을 다시 적을 뿐이다.
 */
export async function claimMakeupAnchorChange(input: {
  tenantId: string;
  reportId: string;
  from: string | null;
  /** 새 반 — upsert가 실패해 되돌릴 때는 옛 값(null일 수 있다). */
  to: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let q = createAdminClient()
    .from("lesson_reports")
    .update({ makeup_class_id: input.to, classnote_class_id: input.to })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.reportId)
    .is("classnote_sent_at", null)
    .or("classnote_status.is.null,classnote_status.not.in.(processing,success,recall_requested,recalling)");
  q = input.from ? q.eq("makeup_class_id", input.from) : q.is("makeup_class_id", null);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: "보강 반을 바꾸지 못했습니다 — 다시 시도해 주세요" };
  if (!data?.length) return { ok: false, error: "보고서가 그새 발송 처리에 들어갔거나 바뀌었습니다 — 새로고침 뒤 다시 시도해 주세요" };
  return { ok: true };
}

/** 보고서 저장 전의 옛 행(보강 앵커 판정 재료). */
export type PriorMakeupRow = {
  makeupClassId: string | null;
  classnoteStatus: string | null;
  classnoteSentAt: string | null;
  createdBy: string | null;
};

export type PreparedAnchor =
  | { ok: true; anchor: string | null; priorAnchor: string | null; move: { plan: MoveCellsPlan; fromClassId: string | null } | null }
  | { ok: false; error: string; needsAnchor?: boolean };

/**
 * **보고서 저장 전** 보강 앵커 확정(원스크린 `saveLessonReport`·관리자 직접 작성이 같은 함수) — 쓰기는 하지 않는다.
 *  · 받은 반이 옛 앵커와 같거나 비었으면 옛 앵커 그대로(재저장이 앵커를 지우지 않는다 — 종강·위임 종료 뒤에도 유지).
 *  · 새 반이면 `acceptMakeupAnchor`로 확인 — 못 받으면 저장 오류(C3: 예전엔 조용히 옛 값으로 두었다).
 *  · 반별 발송 대상인데 앵커가 없으면 '반 미정' 오류(`needsAnchor`).
 *  · 앵커가 바뀌면 잠금(게시·게시 중·회수 중) 확인 → 칸 이동 계획(막히면 오류) — **보고서를 쓰기 전에**.
 * @param candidatesFor 앵커 후보를 읽을 강사(원스크린 = 저장한 강사 · 관리자 = 관리자 본인 — 학생이 다니는 반은 누구에게나 후보다).
 */
export async function prepareMakeupAnchor(
  supabase: ServerClient,
  input: {
    tenantId: string;
    candidatesFor: string;
    studentId: string;
    date: string;
    subject: string | null | undefined;
    wanted: string | null;
    prior: PriorMakeupRow | null;
    anchorRequired: () => Promise<boolean>;
  },
): Promise<PreparedAnchor> {
  const priorAnchor = input.prior?.makeupClassId ?? null;
  let anchor: string | null = priorAnchor;
  if (input.wanted && input.wanted !== priorAnchor) {
    let cands: AnchorCandidate[];
    try {
      cands = await loadMakeupAnchorCandidates(supabase, {
        tenantId: input.tenantId,
        userId: input.candidatesFor,
        studentId: input.studentId,
        date: input.date,
      });
    } catch {
      return { ok: false, error: "보강 반을 확인하지 못했습니다 — 저장하지 않았습니다. 다시 시도해 주세요" };
    }
    const accepted = acceptMakeupAnchor(cands, input.wanted, input.subject, input.date);
    if (!accepted) return { ok: false, error: MAKEUP_ANCHOR_REJECTED_ERROR };
    anchor = accepted.id;
  }
  if (!anchor && (await input.anchorRequired())) return { ok: false, error: MAKEUP_ANCHOR_REQUIRED_ERROR, needsAnchor: true };
  let move: { plan: MoveCellsPlan; fromClassId: string | null } | null = null;
  if (input.prior && anchor && anchor !== priorAnchor) {
    const locked = makeupAnchorLockedReason({ classnoteStatus: input.prior.classnoteStatus, classnoteSentAt: input.prior.classnoteSentAt });
    if (locked) return { ok: false, error: locked };
    const planned = await planReportAnchorMove({
      tenantId: input.tenantId,
      studentId: input.studentId,
      date: input.date,
      prevAnchor: priorAnchor,
      ownerId: input.prior.createdBy,
      toClassId: anchor,
    });
    if ("error" in planned) return { ok: false, error: planned.error };
    move = planned;
  }
  return { ok: true, anchor, priorAnchor, move };
}

/**
 * **보고서 저장 뒤** 앵커 반에 칸을 맞춘다(원스크린·관리자 직접 작성 공용) — 옮길 칸은 옮기고, 없으면 세운다(시수·결석분 메모는
 * 확인창이 명단 세션에 적어 둔 값). 실패하면 보고서의 반을 옛 값으로 되돌리고 오류를 돌려준다(둘이 갈린 채로 두지 않는다).
 * 반을 옮겼으면 감사로그(`makeup_class_change`).
 */
export async function finishMakeupAnchor(
  supabase: ServerClient,
  input: {
    tenantId: string;
    reportId: string;
    studentId: string;
    date: string;
    subject: string;
    anchor: string;
    priorAnchor: string | null;
    move: { plan: MoveCellsPlan; fromClassId: string | null } | null;
    ownerId: string | null;
    via: "report_save" | "admin_compose";
  },
): Promise<{ ok: true; makeupEffect?: MakeupEffectNotice } | { ok: false; error: string }> {
  const entry = input.ownerId
    ? await supabase
        .from("onescreen_daily_sessions")
        .select("subject_progress")
        .eq("tenant_id", input.tenantId)
        .eq("updated_by", input.ownerId)
        .eq("student_id", input.studentId)
        .eq("session_date", input.date)
        .maybeSingle()
        .then(
          ({ data }) => makeupSessionEntries(data?.subject_progress).find((e) => e.subject === input.subject) ?? null,
          () => null,
        )
    : null;
  const synced = await syncAnchorCells({
    tenantId: input.tenantId,
    studentId: input.studentId,
    date: input.date,
    anchor: input.anchor,
    ownerId: input.ownerId,
    move: input.move,
    units: entry?.units ?? null,
    note: entry?.absentDate ? makeupMemo(entry.absentDate, input.date) : null,
  });
  if (!synced.ok) {
    if (input.move)
      await createAdminClient()
        .from("lesson_reports")
        .update({ makeup_class_id: input.priorAnchor, classnote_class_id: input.priorAnchor })
        .eq("tenant_id", input.tenantId)
        .eq("id", input.reportId)
        .eq("makeup_class_id", input.anchor)
        .is("classnote_sent_at", null);
    return { ok: false, error: `보고서는 저장됐지만 출석부 보강 칸을 적지 못했습니다 — 다시 저장해 주세요(${synced.error})` };
  }
  if (input.move)
    await logAction({
      action: "makeup_class_change",
      targetType: "lesson_report",
      metadata: {
        reportId: input.reportId,
        studentId: input.studentId,
        date: input.date,
        subject: input.subject,
        fromClassId: input.priorAnchor,
        toClassId: input.anchor,
        movedCells: synced.moved,
        createdCell: synced.created,
        via: input.via,
      },
    });
  // 출결 칸은 섰다. 보강 기록 반영이 남았으면 그 사실만 올린다(저장은 성공이다).
  return { ok: true, ...(synced.makeupEffect ? { makeupEffect: synced.makeupEffect } : {}) };
}
