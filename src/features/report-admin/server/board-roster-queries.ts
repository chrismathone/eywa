import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { classKey, boardKey } from "../english-writing";
import {
  checkClassRosters,
  summarize,
  type BoardSnapshot,
  type ChildLink,
  type ClassCheck,
  type ClassRoster,
} from "../board-roster-diff";

export type BoardRosterView = {
  checks: ClassCheck[];
  summary: ReturnType<typeof summarize>;
  /** 스냅샷 시각(가장 최근 동기화). null = 워커가 아직 한 번도 안 돌았다 — 화면이 "문제 없음"으로 보이면 안 된다. */
  syncedAt: string | null;
  /** 연결/해제 버튼 노출 여부 — 열람 전용 계정에 버튼을 보여 놓고 거부하지 않는다. */
  canLink: boolean;
};

/**
 * aywa 반 ↔ ClassNote 반 보드 구성 점검.
 *
 * 대상 = **반 보드로 운영되는 과목**(현재 영어). 수학은 학생 1인 보드라 이 점검의 단위가 아니고,
 * provision/assign 스크립트가 이미 담당한다.
 *
 * ⚠️ 판정은 전부 순수 함수(board-roster-diff)가 한다 — 여기서는 조회만. 규칙이 바뀌면 재계산된다.
 * ⚠️ 스냅샷이 없으면 checks를 비워 돌려준다. 빈 스냅샷으로 대조하면 **전원 미배정**으로 보여
 *    "ClassNote가 다 망가졌다"는 거짓 경보가 된다.
 */
export async function getBoardRosterCheck(subject = "english"): Promise<BoardRosterView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!classnoteModuleOn(await getTenantSettings())) return null;
  const supabase = await createClient();
  const today = kstToday();

  const [{ data: boardRows }, memberRows, { data: classRows }, { data: linkRows }, canLink] = await Promise.all([
    supabase.from("classnote_boards").select("board_id, board_name, synced_at"),
    // 원아는 반 수 × 인원이라 수백 행 — 1000행 절단(B2)을 피해 페이지네이션으로 전건.
    fetchAllPaged<{ board_id: number; child_id: number; child_name: string; birth_year: number | null }>((from, to) =>
      supabase
        .from("classnote_board_members")
        .select("board_id, child_id, child_name, birth_year")
        .order("board_id")
        .order("child_id")
        .range(from, to),
    ),
    supabase
      .from("classes")
      .select(
        "id, class_name, teacher:teacher_id ( display_name ), enrollments ( end_date, students ( id, name, classnote_name, grade, status, is_test ) )",
      )
      .eq("subject", subject)
      .eq("is_active", true)
      // '수업보고서 미발송' 반(0174a)은 보드 대조에서도 뺀다 — 보고서를 안 쓰기로 한 반을
      // "보드가 없다"고 매일 지적하면 그게 곧 잡음이다.
      .eq("report_optout", false),
    supabase.from("classnote_student_links").select("student_id, board_id, child_id, child_name_at_link"),
    canWriteTenant(user.systemRole, "lesson_reports"),
  ]);

  const syncedAt = (boardRows ?? []).reduce<string | null>((acc, b) => {
    const s = b.synced_at as string | null;
    return s && (!acc || s > acc) ? s : acc;
  }, null);
  if (!boardRows?.length) return { checks: [], summary: summarize([]), syncedAt: null, canLink };

  const membersByBoard = new Map<number, BoardSnapshot["members"]>();
  for (const m of memberRows ?? []) {
    const list = membersByBoard.get(m.board_id) ?? [];
    list.push({ childId: m.child_id, childName: m.child_name, birthYear: m.birth_year });
    membersByBoard.set(m.board_id, list);
  }
  const boards: BoardSnapshot[] = boardRows.map((b) => ({
    boardId: b.board_id as number,
    boardName: b.board_name as string,
    members: membersByBoard.get(b.board_id as number) ?? [],
  }));

  const links: ChildLink[] = (linkRows ?? []).map((l) => ({
    studentId: l.student_id as string,
    boardId: l.board_id as number,
    childId: l.child_id as number,
    childNameAtLink: l.child_name_at_link as string,
  }));

  const classes: ClassRoster[] = (classRows ?? []).map((c) => {
    const t = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as { display_name?: string } | null;
    // PostgREST 임베드는 관계를 배열로 타이핑한다(실제로는 to-one) — 단일 객체로 좁히려면 unknown 경유가 필요.
    const enr = (c.enrollments ?? []) as unknown as {
      end_date: string | null;
      students: {
        id: string;
        name: string;
        classnote_name: string | null;
        grade: string | null;
        status: string;
        is_test: boolean;
      } | null;
    }[];
    const seen = new Set<string>();
    const students = enr
      // 발송 대상과 같은 조건 — 재원 + 유효 수강 + 테스트 학생 제외(0141a).
      .filter((e) => (!e.end_date || e.end_date >= today) && e.students?.status === "enrolled" && !e.students?.is_test)
      .map((e) => ({
        studentId: e.students!.id,
        // ClassNote 원아 매칭 키 = **유효이름**(classnote_name 오버라이드 || name) — 워커 발송과 동일 규약.
        name: (e.students!.classnote_name?.trim() || e.students!.name || "").trim(),
        grade: e.students!.grade,
      }))
      // 같은 학생이 한 반에 두 수강행을 가질 수 있다(분리등원) — 로스터엔 한 번만.
      .filter((s) => {
        if (!s.name || seen.has(s.studentId)) return false;
        seen.add(s.studentId);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return {
      classId: c.id as string,
      className: c.class_name as string,
      teacher: t?.display_name ?? null,
      students,
    };
  });

  const checks = checkClassRosters(classes, boards, { class: classKey, board: boardKey }, { links })
    // 문제 있는 반부터(원장이 찾는 건 어긋난 반이다). 같은 등급이면 반 이름 순.
    .sort((a, b) => b.problems - a.problems || a.className.localeCompare(b.className, "ko"));

  return { checks, summary: summarize(checks), syncedAt, canLink };
}
