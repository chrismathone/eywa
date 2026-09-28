import "server-only";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { newcomerWindowStart } from "../onboarding-items";
import { ANY_SUBJECT } from "../subject-rows";
import { CONSULT_LINK_ITEM_KEYS, type NewcomerLinkTarget } from "../consult-link";
import { getNewcomers } from "./queries";

/**
 * 상담 → 신규생 체크 **반자동 연결**의 조회·쓰기(0294a). 규칙은 [`consult-link.ts`](../consult-link.ts).
 *
 * ⚠️ 이 파일은 `"use server"`가 아니다([[#119]]) — 원생상담 서버 액션이 import하는 헬퍼다.
 * 🔴 권한: 연결은 **그 상담을 쓸 수 있는 사람**이면 한다 — 상담 저장 게이트(담당 범위 포함)를 이미 지난 뒤에만
 *    불린다. 강사가 자기 학생에게 건 사전 콜이 곧 이 기능의 대상이라, 신규생 메뉴 쓰기 권한을 따로 요구하면
 *    반자동이 강사에게서 통째로 막힌다.
 * 🔴 쓰기는 admin 클라이언트다(0251a는 select 정책만 있다 — 세션 upsert는 RLS가 조용히 거부). admin은 RLS를
 *    우회하므로 모든 조회·쓰기에 `tenant_id`를 건다.
 * 🔴 **손 체크가 이긴다** — 다른 경로로 이미 완료된 칸은 덮어쓰지 않는다(데스크가 적은 날짜가 사실이다).
 * ⚠️ 0294a 미적용이면 `consultation_id`가 없다 — 그때는 연결 없이 체크만 한다([[#95]]). 되돌리기(수정·삭제)는
 *    그 컬럼으로 찾으니 SQL 적용 전 체크는 상담을 지워도 남는다.
 */

type Admin = ReturnType<typeof createAdminClient>;

function isMissingColumn(message: string): boolean {
  return /consultation_id/i.test(message) && /42703|PGRST204|does not exist|Could not find/i.test(message);
}

/**
 * 상담 폼에 내려 줄 신규생 목록 — 신규생 관리 표와 **같은 조회**(`getNewcomers`)의 과목 행이다.
 * 체크 표를 못 읽으면 빈 목록(연결 칸을 안 띄운다 — 완료 여부를 모르고 제안하면 손 체크를 덮으려 든다).
 */
export async function getNewcomerLinkTargets(consultationId?: string): Promise<NewcomerLinkTarget[]> {
  const view = await getNewcomers();
  if (!view.checksAvailable) return [];
  const linked = new Map<string, string[]>(); // `학생|과목` → 이 상담으로 한 항목
  if (consultationId) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("student_onboarding_checks")
      .select("student_id, subject, item_key, done_on")
      .eq("consultation_id", consultationId);
    // 컬럼이 아직 없으면(0294a 전) 연결된 것이 없는 것과 같다.
    for (const r of error ? [] : (data ?? [])) {
      if (!r.done_on) continue;
      const k = `${r.student_id}|${r.subject ?? ""}`;
      linked.set(k, [...(linked.get(k) ?? []), r.item_key as string]);
    }
  }
  const byStudent = new Map<string, NewcomerLinkTarget>();
  for (const row of view.subjectRows) {
    let t = byStudent.get(row.studentId);
    if (!t) byStudent.set(row.studentId, (t = { studentId: row.studentId, rows: [] }));
    // 🔴 과목 무관('') 연결을 과목 줄에 비추지 않는다 — 비추면 과목마다 같은 칸이 잡혀, 저장 한 번에 수학 콜이
    //    영어 칸까지 닫는다. 그 연결은 과목 줄에선 '완료'로만 보이고(체크는 과목 무관 기록이 모든 과목에 비친다),
    //    폼이 그 줄을 안 그리므로 저장해도 건드리지 않는다(`renderedSubjects`).
    const own = linked.get(`${row.studentId}|${row.subject ?? ""}`) ?? [];
    t.rows.push({
      subject: row.subject,
      enrolledOn: row.enrolledOn,
      firstClassOn: row.firstClassOn,
      checks: row.checks,
      ...(own.length ? { linked: own } : {}),
    });
  }
  return [...byStudent.values()];
}

/** 이 학생이 그 과목 반을 실제로 듣나 — 화면이 보낸 과목을 서버가 다시 확인한다([[#77]]). */
export async function studentTakesSubject(
  admin: Admin,
  tenantId: string,
  studentId: string,
  subject: string,
): Promise<{ ok: true; takes: boolean } | { ok: false }> {
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("class_id")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (enrErr) return { ok: false };
  const classIds = [...new Set((enr ?? []).map((e) => e.class_id as string | null).filter((v): v is string => !!v))];
  if (classIds.length === 0) return { ok: true, takes: false };
  const { data: cls, error: clsErr } = await admin
    .from("classes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("subject", subject)
    .in("id", classIds)
    .limit(1);
  if (clsErr) return { ok: false };
  return { ok: true, takes: (cls ?? []).length > 0 };
}

type LinkedRow = {
  id: string;
  student_id: string;
  subject: string;
  item_key: string;
  done_on: string | null;
  done_by: string | null;
};

async function linkedRowsOf(admin: Admin, tenantId: string, consultationId: string): Promise<LinkedRow[] | null> {
  const { data, error } = await admin
    .from("student_onboarding_checks")
    .select("id, student_id, subject, item_key, done_on, done_by")
    .eq("tenant_id", tenantId)
    .eq("consultation_id", consultationId);
  if (error) return isMissingColumn(error.message) ? [] : null;
  return (data ?? []) as LinkedRow[];
}

/**
 * 이 상담으로 한 체크를 푼다 — 행은 지우지 않고 완료일만 비운다(0251a 해제 규약).
 * 🔴 **읽은 그대로일 때만** 푼다 — 읽고 푸는 사이 데스크가 손으로 다시 체크했으면 그 체크가 이긴다. 평소엔 연결이
 *    그대로인지로, 상담 삭제 뒤엔(FK가 이미 null) 완료일·처리자가 그대로인지로 가린다.
 */
async function unlinkRows(
  admin: Admin,
  tenantId: string,
  consultationId: string,
  rows: readonly LinkedRow[],
  afterDelete = false,
) {
  for (const r of rows) {
    let q = admin
      .from("student_onboarding_checks")
      .update({ done_on: null, done_by: null, consultation_id: null })
      .eq("tenant_id", tenantId)
      .eq("id", r.id);
    q = afterDelete ? q.is("consultation_id", null) : q.eq("consultation_id", consultationId);
    q = r.done_on ? q.eq("done_on", r.done_on) : q.is("done_on", null);
    q = r.done_by ? q.eq("done_by", r.done_by) : q.is("done_by", null);
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    if (!r.done_on || (data ?? []).length === 0) continue;
    await logAction({
      action: "newcomer_uncheck",
      targetType: "student",
      metadata: {
        studentId: r.student_id,
        itemKey: r.item_key,
        doneOn: null,
        subject: r.subject,
        consultationId,
        via: "consultation",
      },
    });
  }
}

/**
 * 한 칸 쓰기 — 🔴 **조건부**다. 읽고 나서 쓰면 그 사이 데스크가 한 손 체크를 덮는다(손 체크가 이긴다는 약속이
 * 깨진다). 그래서 기존 행은 `완료일이 비었거나 이 상담의 것`일 때만 갱신하고, 없으면 insert(동시에 생겼으면
 * 유니크 위반 → 건너뜀). 쓴 게 있으면 true.
 */
async function writeLinkedCheck(
  admin: Admin,
  input: ConsultLinkInput,
  p: { subject: string; itemKey: string },
): Promise<boolean> {
  // 한 칸의 자연키 — 0256a 유니크(테넌트·학생·과목·항목)와 같다.
  const key = { tenant_id: input.tenantId, student_id: input.studentId, subject: p.subject, item_key: p.itemKey };
  const values = { done_on: input.consultedOn, done_by: input.userId, consultation_id: input.consultationId };
  const { data: cur, error: curErr } = await admin
    .from("student_onboarding_checks")
    .select("id, done_on, consultation_id")
    .match(key)
    .maybeSingle();
  if (curErr && !isMissingColumn(curErr.message)) throw new Error(curErr.message);
  if (curErr) {
    // 0294a 전 — 연결 칸이 없다. 비어 있는 칸만 채운다(연결 없이 체크만, [[#95]]).
    const { data: inserted, error } = await admin
      .from("student_onboarding_checks")
      .upsert(
        { ...key, done_on: input.consultedOn, done_by: input.userId },
        { onConflict: "tenant_id,student_id,subject,item_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    if ((inserted ?? []).length > 0) return true;
    const again = await admin
      .from("student_onboarding_checks")
      .update({ done_on: input.consultedOn, done_by: input.userId })
      .match(key)
      .is("done_on", null)
      .select("id");
    if (again.error) throw new Error(again.error.message);
    return (again.data ?? []).length > 0;
  }
  if (!cur) {
    const { error } = await admin.from("student_onboarding_checks").insert({ ...key, ...values });
    if (error?.code === "23505") return false; // 그 사이 누가 먼저 만들었다 — 그쪽이 이긴다.
    if (error) throw new Error(error.message);
    return true;
  }
  const mine = !!cur.done_on && cur.consultation_id === input.consultationId;
  if (cur.done_on && !mine) return false;
  if (mine && cur.done_on === input.consultedOn) return false;
  const { data: upd, error } = await admin
    .from("student_onboarding_checks")
    .update(values)
    .eq("tenant_id", input.tenantId)
    .eq("id", cur.id)
    .or(`done_on.is.null,consultation_id.eq.${input.consultationId}`)
    .select("id");
  if (error) throw new Error(error.message);
  return (upd ?? []).length > 0;
}

export type ConsultLinkInput = {
  tenantId: string;
  userId: string;
  consultationId: string;
  studentId: string;
  /** 상담일(KST `YYYY-MM-DD`) — 체크의 완료일이 된다. */
  consultedOn: string;
  /**
   * 폼이 **그린 과목 줄**(과목 무관 = `''`). 🔴 풀기는 이 줄의 연결만 — 안 그린 줄(신규생이 아니게 됐거나,
   * 그만둔 과목, 과목 무관 옛 연결)의 체크를 "안 골랐다"로 읽어 풀면 끝난 콜이 조용히 사라진다.
   */
  renderedSubjects: ReadonlySet<string>;
  picks: ReadonlyArray<{ subject: string; itemKey: string }>;
};

/**
 * 상담 저장 직후 — 고른 칸을 완료로, 이 상담으로 했던 칸 중 빠진 것은 해제한다.
 * 🔴 상담은 **이미 저장됐다** — 여기서 실패해도 상담 저장을 되돌리지 않는다(재제출하면 상담이 두 번 생긴다).
 *    대신 한글 사유를 돌려주고 호출부가 로그로 남긴다.
 */
export async function applyConsultationNewcomerLinks(input: ConsultLinkInput): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const existing = await linkedRowsOf(admin, input.tenantId, input.consultationId);
  if (!existing) return { error: "신규생 체크 연결을 확인하지 못했습니다" };

  const picks = new Map<string, { subject: string; itemKey: string }>();
  for (const p of input.picks) {
    if (CONSULT_LINK_ITEM_KEYS.includes(p.itemKey)) picks.set(`${p.subject}|${p.itemKey}`, p);
  }

  try {
    // ① 풀 것 — 학생이 바뀌었으면 옛 학생 쪽 전부, 그린 과목 줄에선 이번에 안 고른 것.
    const drop = existing.filter(
      (r) =>
        r.student_id !== input.studentId ||
        (input.renderedSubjects.has(r.subject) && !picks.has(`${r.subject}|${r.item_key}`)),
    );
    await unlinkRows(admin, input.tenantId, input.consultationId, drop);
    // 그린 줄의 선택만 받는다 — 폼 밖에서 끼워 넣은 과목 값은 버린다.
    for (const [k, p] of picks) if (!input.renderedSubjects.has(p.subject)) picks.delete(k);
    if (picks.size === 0) return {};

    // ② 이 학생이 지금 신규생(90일 창 안 재원·휴원)인지 — 화면이 보낸 학생을 그대로 믿지 않는다.
    const { data: student } = await admin
      .from("students")
      .select("id, name, enrolled_at, status")
      .eq("tenant_id", input.tenantId)
      .eq("id", input.studentId)
      .maybeSingle();
    const enrolledOn = student?.enrolled_at ? String(student.enrolled_at).slice(0, 10) : null;
    if (
      !student ||
      !["enrolled", "on_hold"].includes(String(student.status)) ||
      !enrolledOn ||
      enrolledOn < newcomerWindowStart(kstToday())
    ) {
      return { error: "신규생 관리 대상이 아니라 체크하지 않았습니다" };
    }

    for (const p of picks.values()) {
      if (p.subject !== ANY_SUBJECT) {
        const takes = await studentTakesSubject(admin, input.tenantId, input.studentId, p.subject);
        if (!takes.ok) throw new Error("수강 과목 확인 실패");
        if (!takes.takes) continue;
      }
      const wrote = await writeLinkedCheck(admin, input, p);
      if (!wrote) continue; // 손 체크·다른 상담으로 이미 완료, 또는 그대로
      // 🔴 손 체크와 같은 감사 행동으로 남긴다 — "어느 상담으로 체크했나"는 metadata가 말한다.
      await logAction({
        action: "newcomer_check",
        targetType: "student",
        targetLabel: (student.name as string | null) ?? null,
        metadata: {
          studentId: input.studentId,
          itemKey: p.itemKey,
          doneOn: input.consultedOn,
          subject: p.subject,
          consultationId: input.consultationId,
          via: "consultation",
        },
      });
    }
    return {};
  } catch {
    return { error: "신규생 체크를 저장하지 못했습니다" };
  } finally {
    revalidatePath("/newcomers");
  }
}

/**
 * 상담 삭제 — **지우기 전에** 이 상담으로 한 체크를 찾아 두고(`prepare`), 삭제가 **성공한 뒤** 푼다(`apply`).
 * 🔴 먼저 풀면 삭제가 실패했을 때 상담은 남고 체크만 사라진다. 지운 뒤엔 FK가 `set null`이라 연결로는 못
 *    찾으므로 행 id를 미리 받아 둔다. 상담이 없는데 "콜 했음"만 남으면 거짓 기록이라 반드시 푼다.
 */
export async function prepareConsultationUnlink(
  tenantId: string,
  consultationId: string,
): Promise<{ error?: string; apply: () => Promise<void> }> {
  const admin = createAdminClient();
  const rows = await linkedRowsOf(admin, tenantId, consultationId);
  if (!rows) return { error: "신규생 체크 연결을 확인하지 못했습니다", apply: async () => {} };
  return {
    apply: async () => {
      if (rows.length === 0) return;
      try {
        await unlinkRows(admin, tenantId, consultationId, rows, true);
      } catch (e) {
        console.error("[consultation] newcomer unlink after delete:", e);
      }
      revalidatePath("/newcomers");
    },
  };
}
