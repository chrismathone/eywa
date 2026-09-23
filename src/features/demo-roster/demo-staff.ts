import { createClient } from "@supabase/supabase-js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

function demoAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase admin env missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** 데모 지점 전시용 강사. 원장 계정과 별개라 '직원 등록'이 채워지고 직원 구성 막대에 과목이 선다. */
const DEMO_STAFF = [
  { email: "demo-math-1@aywa.co.kr", name: "한지민", subject: "math" },
  { email: "demo-math-2@aywa.co.kr", name: "오승현", subject: "math" },
  { email: "demo-math-3@aywa.co.kr", name: "배수정", subject: "math" },
  { email: "demo-eng-1@aywa.co.kr", name: "서하은", subject: "english" },
  { email: "demo-eng-2@aywa.co.kr", name: "문지호", subject: "english" },
  { email: "demo-eng-3@aywa.co.kr", name: "류다인", subject: "english" },
] as const;

export type DemoStaffIds = { math: string[]; english: string[] };

/** 이미 있으면 그 계정을 쓰고, 없으면 데모 지점에만 강사 계정을 만든다. 비밀번호는 저장하지 않는다. */
export async function ensureDemoStaff(tenantId: string): Promise<DemoStaffIds> {
  const emails = DEMO_STAFF.map((row) => row.email);
  const existing = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.email, [...emails])));
  const byEmail = new Map(existing.map((row) => [row.email, row.id]));
  const admin = demoAdmin();

  for (const row of DEMO_STAFF) {
    if (byEmail.has(row.email)) continue;
    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: row.email,
      password,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, system_role: "teacher" },
      user_metadata: { display_name: row.name },
    });
    if (error || !data.user) throw new Error(error?.message ?? "강사 계정을 만들지 못했습니다");
    byEmail.set(row.email, data.user.id);
  }

  const ids = [...byEmail.values()];
  if (ids.length) {
    for (const row of DEMO_STAFF) {
      const id = byEmail.get(row.email);
      if (!id) continue;
      await db
        .update(users)
        .set({
          tenantId,
          displayName: row.name,
          systemRole: "teacher",
          status: "active",
          subjects: [row.subject],
          jobTitle: "강사",
          hireDate: "2026-03-02",
          memo: "demo-roster:staff",
        })
        .where(eq(users.id, id));
    }
  }

  const grouped: DemoStaffIds = { math: [], english: [] };
  for (const row of DEMO_STAFF) {
    const id = byEmail.get(row.email);
    if (id) grouped[row.subject].push(id);
  }
  return grouped;
}
