import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canonicalSchoolName } from "@/features/schools/school-name";
import { findSamePersonConsultations } from "@/features/enrollment/server/same-person-query";

/**
 * 새 신규 콜&상담을 적는 중 '이 학생의 이전 상담' 안내(원장 2026-10-19 *"같은 학생이 상담을 여러번 올 경우 체크"* 2번).
 * 이름 + (보호자 연락처 또는 학교·학년)을 받아 같은 학생의 이전 상담(최근 10건 + 전체 건수)을 돌려준다 — 판정은 카드 'N건' 배지·상세 '다른 상담'과
 * 같은 한 벌(`same-person.ts`). 학교는 저장할 때와 같은 표기로 바꿔 비교한다("칠성초등학교" → "칠성초").
 * 권한 = 신규 콜&상담 열람(작성 화면의 `requireAccess("enrollment")`와 같은 메뉴) — 라우트라 이동 대신 401/403 JSON.
 * 세션 클라이언트(RLS)라 다른 학원 상담은 안 보인다. 연락처는 돌려주지 않는다(화면에 필요 없다).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await canAccessTenant(user.systemRole, "enrollment"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const text = (key: string) => (params.get(key) ?? "").trim().slice(0, 60) || null;
  const name = text("name");
  if (!name) return NextResponse.json({ items: [] });
  const aliases = (await getTenantSettings()).operations.schoolSaveAliases;
  const rows = await findSamePersonConsultations(
    await createClient(),
    {
      id: "",
      student_id: null,
      prospect_name: name,
      parent_phone: text("phone"),
      prospect_school: canonicalSchoolName(text("school"), aliases),
      prospect_grade: text("grade"),
    },
  );
  // 목록은 최근 10건까지 · 건수는 전체(목록 길이를 건수로 쓰면 12건도 "10건" — [[#89]]).
  return NextResponse.json({
    total: rows.length,
    items: rows.slice(0, 10).map((r) => ({
      id: r.id,
      name: r.prospect_name ?? "",
      school: r.prospect_school ?? null,
      grade: r.prospect_grade ?? null,
      subject: r.subject,
      outcome: r.outcome,
      consultedAt: r.consulted_at,
    })),
  });
}
