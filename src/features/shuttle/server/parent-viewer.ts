import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { schoolGradeLabel } from "@/lib/format/school-grade";

export type ParentChild = { id: string; name: string; schoolGrade: string; relationship: string };

export type ParentViewer = {
  parentAccountId: string;
  tenantId: string;
  displayName: string;
  children: ParentChild[];
};

/**
 * 로그인한 사람이 **학부모 계정**이면 그 학부모와 연결된 아이들, 아니면 null.
 *
 * 🔑 학부모는 직원 표(`public.users`)에 없다(0313a) — 그래서 `getCurrentUser()`는 null이고, DB 정책의
 *    `auth_tenant_id()`도 null이라 학부모 세션으로는 **어떤 표도 직접 못 읽는다**. 그래서 여기서만
 *    service_role로 읽되, 반드시 **이 세션의 학부모 → 그 학부모에게 연결된 아이**로만 좁힌다.
 * 🔴 아이 목록은 `parent_account_students`에서만 온다 — 주소·폼으로 받은 학생 id를 믿지 않는다([[#77]]).
 * 🔴 중지(inactive) 계정은 null — 계정을 멈추면 곧바로 아무것도 안 보인다.
 */
export const getParentViewer = cache(async (): Promise<ParentViewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;

  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("parent_accounts")
    .select("id, tenant_id, display_name, status")
    .eq("auth_user_id", sub)
    .maybeSingle();
  if (error || !account || account.status !== "active") return null;

  // 한 학부모에게 연결된 아이는 몇 명뿐이다 — 상한을 명시한다(B2).
  const { data: links, error: linkError } = await admin
    .from("parent_account_students")
    .select("student_id, relationship")
    .eq("tenant_id", account.tenant_id)
    .eq("parent_account_id", account.id)
    .limit(20);
  if (linkError) throw linkError;

  const ids = (links ?? []).map((l) => l.student_id);
  const { data: students, error: studentError } = ids.length
    ? await admin
        .from("students")
        .select("id, name, school, grade")
        .eq("tenant_id", account.tenant_id)
        .in("id", ids)
    : { data: [], error: null };
  if (studentError) throw studentError;

  const byId = new Map((students ?? []).map((s) => [s.id, s]));
  return {
    parentAccountId: account.id,
    tenantId: account.tenant_id,
    displayName: account.display_name,
    children: (links ?? []).flatMap((l) => {
      const s = byId.get(l.student_id);
      return s
        ? [{ id: s.id, name: s.name, schoolGrade: schoolGradeLabel(s.school, s.grade), relationship: l.relationship }]
        : [];
    }),
  };
});
