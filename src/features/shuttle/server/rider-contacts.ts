import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { normalizePhone } from "@/features/students/lib/student-import";
import { canSeeBoardingContacts } from "./record-gate";

/** 한 학생의 연락처 — 줄 위에 "학생 · 학부모" 번호를 띄운다. 없으면 null·빈 배열(화면은 빈칸). */
export type RiderContact = {
  /** 원생 기록의 학생 본인 번호(`students.student_phone`). */
  student: string | null;
  /** **연결된 활성 학부모 계정**의 번호(`parent_accounts.phone`) — 대표 보호자 먼저, 중복 제거. */
  parents: string[];
};

/**
 * 오늘 등하원 줄의 학생·학부모 전화번호(사용자 2026-10-21 *"탑승 미탑승 위에 학생 학부모 전화번호 … 학부모 계정연결을 해야
 * 부모님 전화번호가 보일거아냐 그렇게 셋팅만 · 없으면 빈칸"*).
 *
 * 🔒 **등하원 기록 자격이 있는 사람만**(`canSeeBoardingContacts` = 사무실 ∪ 셔틀 담당 ∪ super_admin — 화면 주인 기준) — 그 밖엔 빈 결과다.
 *    읽기 강사뷰는 쓰기 자격(`canRecordBoarding`)이 늘 막히지만 **보는 것**은 대상 강사와 같아야 해서 읽기 판정을 따로 둔다(record-gate.ts).
 *    페이지가 이미 같은 판정으로 부르지만, 다른 호출부가 생겨도 여기서 다시 막는다([[#77]]).
 * 🔑 학부모 번호는 **학부모 계정 연결**에서만 온다 — 원생 기록의 `parent_phone`(makeedu 이관 값)은 쓰지 않는다(사용자 지시).
 *    그래서 계정을 연결하기 전엔 빈칸이다.
 * ⚠️ admin 클라이언트 — 학부모 표(0290a)는 원장·관리자만 읽게 잠겨 있어 셔틀 담당(viewer)은 세션으로 0행을 받는다([[#104]]).
 *    그래서 **`tenant_id` 필터를 반드시** 건다.
 * 🔑 번호는 **형식을 맞춰** 낸다(`normalizePhone` — 학생 가져오기와 같은 규칙: 숫자만 → 010-1234-5678). 원생 기록·학부모 계정엔
 *    하이픈 없는 번호·띄어쓰기 섞인 번호가 섞여 있어 그대로 내면 화면에서 깨져 보였다(사용자 2026-10-21).
 * ⚠️ 실패해도 화면은 산다 — 번호가 빈칸으로 보일 뿐이다(셔틀 기록이 멈추면 안 된다).
 */
export async function getRiderContacts(studentIds: readonly string[]): Promise<Record<string, RiderContact>> {
  const ids = [...new Set(studentIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const user = await getCurrentUser();
  if (!user || !(await canSeeBoardingContacts())) return {};
  const admin = createAdminClient();
  const tenantId = user.tenantId;
  try {
    const [students, links] = await Promise.all([
      fetchInChunks<{ id: string; student_phone: string | null }>(ids, (chunk) =>
        admin.from("students").select("id, student_phone").eq("tenant_id", tenantId).in("id", chunk),
      ),
      fetchInChunks<{ student_id: string; parent_account_id: string; is_primary: boolean | null }>(ids, (chunk) =>
        admin
          .from("parent_account_students")
          .select("student_id, parent_account_id, is_primary")
          .eq("tenant_id", tenantId)
          .in("student_id", chunk),
      ),
    ]);
    const accountIds = [...new Set(links.map((l) => l.parent_account_id))];
    const accounts = await fetchInChunks<{ id: string; phone: string | null; status: string }>(accountIds, (chunk) =>
      admin.from("parent_accounts").select("id, phone, status").eq("tenant_id", tenantId).in("id", chunk),
    );
    const phoneOf = new Map(accounts.filter((a) => a.status === "active").map((a) => [a.id, normalizePhone(a.phone)]));

    const out: Record<string, RiderContact> = {};
    for (const s of students) out[s.id] = { student: normalizePhone(s.student_phone), parents: [] };
    // 대표 보호자 먼저.
    const sorted = [...links].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary));
    for (const l of sorted) {
      const phone = phoneOf.get(l.parent_account_id);
      if (!phone) continue;
      const c = (out[l.student_id] ??= { student: null, parents: [] });
      if (!c.parents.includes(phone)) c.parents.push(phone);
    }
    return out;
  } catch (e) {
    reportError(e, { where: "getRiderContacts" });
    return {};
  }
}
