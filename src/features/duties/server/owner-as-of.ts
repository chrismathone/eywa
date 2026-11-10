import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { buildHomeroomHistoryIndex, buildUniqueClassNameIndex, homeroomTeacherOnDate, resolveTransitionClassId } from "@/features/classes/teacher-as-of";
import { toTransitions, transitionRows } from "@/features/teacher-portfolio/server/churn-source";

/**
 * 그날의 담당 — 지난 날을 맞출 때 **그날의 담임**과 **그날 재직 중이었는지**를 본다
 * (원장 2026-11-11 *"퇴사한 선생님은 퇴사한 날짜에 맞춰서 등장하고 사라질 수 있게"*).
 *
 *   · 담임 = 담임 변경 기록(인수인계 · 반 수정 감사로그 — 강사평가와 같은 재료 `transitionRows`). 기록이 닿지 않는 날은 지금 담임 그대로.
 *   · 퇴사일 = 직원관리 퇴사 처리가 계약 이력에 남긴 '퇴사 (날짜)' 줄. 줄이 없는 옛 퇴사는 계정이 마지막으로 바뀐 날로 추정한다(7일보다 오래된 날에만).
 *     퇴사일 **다음 날부터** 담당에서 빠진다(퇴사일 당일까지는 그 사람 업무). 지금 재직 중이면 옛 퇴사 줄이 있어도 재직이다.
 *
 * 🔴 관리 키(RLS 우회)라 모든 조회에 tenant_id(#104) · 전건 페이징(B2).
 */
export type OwnerAsOf = {
  /** 그날 그 반의 담임(모르면 지금 담임). */
  teacherOf: (classId: string, current: string | null, date: string) => string | null;
  /** 그날 이미 퇴사한 사람인가. */
  retiredOn: (teacherId: string, date: string) => boolean;
};

const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const memo = new Map<string, { at: number; value: Promise<OwnerAsOf> }>();

/** 한 번 맞춤(여러 날)에서 되풀이해 부른다 — 지점마다 1분 동안 같은 값을 쓴다. */
export function loadOwnerAsOf(tenantId: string): Promise<OwnerAsOf> {
  const hit = memo.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = load(tenantId);
  memo.set(tenantId, { at: Date.now(), value });
  value.catch(() => memo.delete(tenantId));
  return value;
}

async function load(tenantId: string): Promise<OwnerAsOf> {
  const admin = createAdminClient();
  const [logs, classes, left, notes] = await Promise.all([
    transitionRows(admin, tenantId),
    fetchAllPaged<{ id: string; class_name: string | null }>((a, b) => admin.from("classes").select("id,class_name").eq("tenant_id", tenantId).order("id").range(a, b)),
    fetchAllPaged<{ id: string; updated_at: string | null }>((a, b) => admin.from("users").select("id,updated_at").eq("tenant_id", tenantId).eq("status", "inactive").order("id").range(a, b)),
    fetchAllPaged<{ user_id: string; start_date: string | null }>((a, b) => admin.from("staff_contracts").select("user_id,start_date").eq("tenant_id", tenantId).eq("kind", "note").ilike("terms", "퇴사%").not("start_date", "is", null).order("id").range(a, b)),
  ]);
  const byName = buildUniqueClassNameIndex(classes.map((c) => ({ id: c.id, name: c.class_name })));
  const transitions = toTransitions(logs).flatMap((t) => {
    const classId = resolveTransitionClassId({ metaClassId: t.class_id, targetLabel: t.target_label, classIdByUniqueName: byName });
    return classId ? [{ classId, date: t.date, teacherId: t.teacher_id, previousTeacherId: t.previous_teacher_id, teacherName: null }] : [];
  });
  const history = buildHomeroomHistoryIndex(transitions);
  // 퇴사일: 퇴사 줄이 여럿이면(퇴사 → 복구 → 퇴사) 가장 늦은 날.
  const noted = new Map<string, string>();
  for (const n of notes) if (n.start_date && n.start_date > (noted.get(n.user_id) ?? "")) noted.set(n.user_id, n.start_date);
  const guessed = new Map<string, string | null>(left.map((u) => [u.id, u.updated_at ? kstDay(u.updated_at) : null]));
  const gone = new Set(left.map((u) => u.id));
  // 🔴 퇴사 줄이 없는 사람의 '계정이 마지막으로 바뀐 날'은 추정일 뿐이고, 계정을 한 번만 고쳐도 앞으로 밀린다 — 최근 7일(실시간으로 다시 맞추는 창)과 오늘에는 쓰지 않는다
  //    (쓰면 오래전 퇴사자가 오늘 업무의 담당으로 되돌아온다 · 리뷰 2026-11-11). 추정은 그보다 오래된 날(지난 달 다시 만들기)에만.
  const recent = addDays(kstToday(), -7);
  return {
    teacherOf: (classId, current, date) => homeroomTeacherOnDate(history.get(classId), current, date) ?? current,
    retiredOn: (teacherId, date) => {
      if (!gone.has(teacherId)) return false;
      const day = noted.get(teacherId) ?? (date < recent ? guessed.get(teacherId) : null);
      return !day || day < date; // 날짜를 모르면 종전대로 늘 퇴사
    },
  };
}
