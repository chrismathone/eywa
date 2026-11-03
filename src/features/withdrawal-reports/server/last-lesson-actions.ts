"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { reportViewer } from "./queries";
import { lastAttendedSettled, type LastLessonRow } from "../last-lesson";

const input = z.object({ studentId: z.uuid(), enrollmentIds: z.array(z.uuid()).max(100) });
const PAGE = 300;
const MAX_PAGES = 10;

/**
 * 요청 창의 '마지막 수업일' 자동 채움(원장 2026-11-03) — 고른 반에서 학생이 마지막으로 수업을 들은 날(`lastAttendedDate`). **읽기만** 한다.
 * 문 = 요청 창과 같은 자격(`reportViewer().request` — 관리자급 · 퇴원보고서 쓰기 · 강사뷰 아님) + 출결 메뉴 열람 + 개인 과목 범위.
 * 지점은 서버가 정한다(수강 줄을 이 지점·이 학생으로 좁혀 반을 얻는다 — 넘겨받은 반 id를 믿지 않는다).
 * 출결은 수업일 늦은 순으로 받아 답이 정해지면 멈춘다(`lastAttendedSettled` — 정정 줄이 갈리지 않게) · 최대 3,000줄.
 * 날짜를 못 찾으면 `date: null`(창은 오늘). 실패는 `error`(창은 오늘로 두고 그렇게 알린다).
 */
export async function loadLastLessonDate(raw: unknown): Promise<{ date: string | null; denied?: true } | { error: string }> {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "퇴원보고서 작성 요청 권한이 없습니다." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "학생과 반을 다시 골라 주세요." };
  const { studentId, enrollmentIds } = parsed.data;
  if (!enrollmentIds.length) return { date: null };
  // 출결을 볼 권한이 없으면 찾지 않는다 — 창은 오늘로 두고 그 까닭을 따로 알린다('기록 없음'과 다르다).
  if (!(await canAccessTenant(viewer.user.systemRole, "attendance"))) return { date: null, denied: true };
  const db = createAdminClient();
  const tenantId = viewer.user.tenantId;
  const { data: rows, error } = await db.from("enrollments").select("id,class_id,classes!inner(subject)")
    .eq("tenant_id", tenantId).eq("student_id", studentId).in("id", enrollmentIds);
  if (error) return { error: "수강 정보를 확인하지 못했습니다." };
  const enrollments = (rows ?? []) as unknown as { id: string; class_id: string; classes: { subject: string } | null }[];
  if (viewer.scope && enrollments.some(e => !e.classes || !viewer.scope!.includes(e.classes.subject))) return { error: "담당 과목의 반만 확인할 수 있습니다." };
  const classIds = [...new Set(enrollments.map(e => e.class_id))];
  if (!classIds.length) return { date: null };
  const today = kstToday();
  const fetched: LastLessonRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error: attendanceError } = await db.from("attendance_records")
      .select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
      .eq("tenant_id", tenantId).eq("student_id", studentId).in("class_id", classIds).lte("session_date", today)
      .order("session_date", { ascending: false }).order("recorded_at", { ascending: false }).order("id", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (attendanceError) return { error: "출결을 불러오지 못했습니다." };
    const chunk = (data ?? []) as LastLessonRow[];
    fetched.push(...chunk);
    const result = lastAttendedSettled(fetched, classIds, today, chunk.length < PAGE);
    if (result.settled) return { date: result.date };
  }
  return { date: lastAttendedSettled(fetched, classIds, today, true).date };
}
