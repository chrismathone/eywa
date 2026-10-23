import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getStudentEnrollmentConsultations } from "@/features/students/server/queries";
import { countAssignedClasses } from "@/features/enrollment/server/assigned-classes";
import { boardStatusOf, type BoardStage } from "@/features/enrollment/board-stages";

/**
 * 퇴원 상세의 '콜&상담' 카드 — 이 학생에 이어진 신규 콜&상담 전부(최신순 · 원장 2026-10-23 *"콜앤상담 연동"*).
 *
 * 🔴 퇴원관리 권한만으로 보여 주지 않는다 — 목적지(`/enrollment/[id]`)와 같은 메뉴 권한(`enrollment`)을 따로 본다.
 * 🔴 조회는 원생 상세 상담 탭과 같은 함수(`getStudentEnrollmentConsultations`) · 상태는 칸반과 같은 판정
 *    (`boardStatusOf` + 반 배정 수 `countAssignedClasses`) — 같은 상담이 화면마다 다른 칸으로 보이지 않게.
 * ⚠️ 실패해도 퇴원 상세를 깨뜨리지 않는다(카드만 안내).
 */

export type LinkedConsultation = { id: string; date: string | null; subject: string | null; stage: BoardStage };
export type LinkedConsultations =
  | { status: "hidden" }
  | { status: "not_ready" }
  | { status: "error" }
  | { status: "ok"; rows: LinkedConsultation[] };

export async function loadLinkedConsultations(studentId: string, role: SystemRole): Promise<LinkedConsultations> {
  try {
    if ((await accessLevelTenant(role, "enrollment")) === "none") return { status: "hidden" };
    const result = await getStudentEnrollmentConsultations(studentId);
    if (result.status !== "ok") return result;
    // 반 배정 수는 상담 과목마다 한 번(학생당 상담 1~3건) — 칸반 배지와 같은 필터 한 벌.
    const supabase = await createClient();
    const subjects = [...new Set(result.rows.map((r) => r.subject ?? ""))];
    const counts = new Map(
      await Promise.all(
        subjects.map(async (s) => [s, await countAssignedClasses(supabase, studentId, s || null)] as const),
      ),
    );
    const rows = result.rows.map((r) => ({
      id: r.id,
      date: r.date,
      subject: r.subject,
      stage: boardStatusOf({ outcome: r.outcome ?? "", assignedClassCount: counts.get(r.subject ?? "") ?? 0 }),
    }));
    // 상담일 최신순(옛 이관분은 등록 시각이 한날이라 원래 순서가 뜻이 없다). 날짜 없는 건은 맨 뒤.
    rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return { status: "ok", rows };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[withdrawals] 이어진 콜&상담 조회 실패", error);
    return { status: "error" };
  }
}
