import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstMonth, kstToday } from "@/lib/date-kst";
import { notYetStartedStudentIds, type ActiveEnrollmentRow } from "@/features/students/enrolled-composition";
import { requireSuperAdmin } from "@/lib/auth/super-admin";


/**
 * 지점별 **아직 한 과목도 시작 안 한 재원생** 수 — 운영실·원생목록의 '실시간 재원생'(원장 2026-09-16)과 **같은 순수 함수**
 * (`notYetStartedStudentIds`). 슈퍼관리자 재원생 = 상태 재원 − 이 수(점검 2026-09-28: 여기만 안 빼서 운영실보다 늘 많았다).
 * admin(RLS 우회)이라 지점을 줄 땐 `tenant_id`로 좁힌다. 없으면 전 지점.
 */
async function notStartedCountByTenant(
  admin: ReturnType<typeof createAdminClient>,
  tenantIds?: readonly string[],
): Promise<Map<string, number>> {
  const rows = await fetchAllPaged<{ id: string; student_id: string; tenant_id: string; start_date: string | null }>(
    (from, to) => {
      let q = admin
        .from("enrollments")
        // 운영실(fetchActiveEnrolledEnrollments)과 같은 조건 — 반이 없는 수강은 세지 않는다(`class!inner`).
        .select("id, student_id, tenant_id, start_date, class:class_id!inner ( id ), student:student_id!inner ( status )")
        .is("end_date", null)
        .eq("on_hold", false)
        .eq("student.status", "enrolled");
      if (tenantIds) q = q.in("tenant_id", [...tenantIds]);
      return q.order("id").range(from, to);
    },
  );
  const byTenant = new Map<string, ActiveEnrollmentRow[]>();
  for (const r of rows) {
    const list = byTenant.get(r.tenant_id) ?? [];
    list.push({ id: r.id, student_id: r.student_id, start_date: r.start_date, class: null });
    byTenant.set(r.tenant_id, list);
  }
  const today = kstToday();
  return new Map([...byTenant].map(([t, list]) => [t, notYetStartedStudentIds(list, today).size]));
}

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
  userCount: number;
  studentCount: number;
  classCount: number;
  monthBilling: number;
  monthInvoiceCount: number;
};

export type SaaSStats = {
  tenantCount: number;
  userCount: number;
  studentCount: number;
  monthBillingSum: number;
};

function currentPeriod() {
  return kstMonth();
}

function exactCount(count: number | null, source: string): number {
  if (count === null) throw new Error(`${source}: exact count missing`);
  return count;
}

// 전체 tenant 목록 + 카운트. multi-tenant read이므로 service_role 사용.
export const getAllTenants = cache(async (): Promise<TenantRow[]> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const period = currentPeriod();

  // users/students/invoices는 전 테넌트 전건을 가져와 JS로 집계 → PostgREST 1000행 한도에
  // silent 절단되면 카운트·청구가 과소된다. 페이지네이션으로 전건 확보(테넌트 증가 대비).
  const notStartedP = notStartedCountByTenant(admin);
  notStartedP.catch(() => {}); // 아래 Promise.all과 동시에 돈다(B4) · 그쪽이 먼저 던져도 이 거부가 떠돌지 않게(실패는 await에서 다시 던져진다)
  const [tenants, users, students, classes, invoices] = await Promise.all([
    fetchAllPaged<{ id: string; slug: string; name: string; plan: string; created_at: string }>((from, to) =>
      admin.from("tenants").select("id, slug, name, plan, created_at").order("created_at", { ascending: false }).order("id").range(from, to),
    ),
    fetchAllPaged<{ tenant_id: string }>((from, to) =>
      admin.from("users").select("tenant_id").order("id").range(from, to),
    ),
    fetchAllPaged<{ tenant_id: string }>((from, to) =>
      admin.from("students").select("tenant_id").eq("status", "enrolled").order("id").range(from, to),
    ),
    fetchAllPaged<{ tenant_id: string }>((from, to) =>
      admin.from("classes").select("tenant_id").eq("is_active", true).order("id").range(from, to),
    ),
    // void(makeedu 삭제분)는 매출 집계에서 제외 — 이하 invoices 합계 쿼리 공통.
    fetchAllPaged<{ tenant_id: string; amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("tenant_id, amount_total").eq("period", period).neq("status", "void").order("id").range(from, to),
    ),
  ]);

  const userCountByTenant = new Map<string, number>();
  users.forEach((u) => {
    userCountByTenant.set(u.tenant_id, (userCountByTenant.get(u.tenant_id) ?? 0) + 1);
  });

  const studentCountByTenant = new Map<string, number>();
  students.forEach((s) => {
    studentCountByTenant.set(s.tenant_id, (studentCountByTenant.get(s.tenant_id) ?? 0) + 1);
  });
  // 실시간 재원생 — 아직 한 과목도 시작 안 한 학생은 뺀다(운영실·원생목록과 같은 규칙, notStartedCountByTenant).
  for (const [t, n] of await notStartedP) studentCountByTenant.set(t, Math.max(0, (studentCountByTenant.get(t) ?? 0) - n));

  const classCountByTenant = new Map<string, number>();
  classes.forEach((c) => {
    classCountByTenant.set(c.tenant_id, (classCountByTenant.get(c.tenant_id) ?? 0) + 1);
  });

  const billingByTenant = new Map<string, number>();
  const invoiceCountByTenant = new Map<string, number>();
  invoices.forEach((i) => {
    const amt = Number(i.amount_total ?? 0);
    billingByTenant.set(i.tenant_id, (billingByTenant.get(i.tenant_id) ?? 0) + amt);
    invoiceCountByTenant.set(i.tenant_id, (invoiceCountByTenant.get(i.tenant_id) ?? 0) + 1);
  });

  return tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    plan: t.plan,
    createdAt: t.created_at,
    userCount: userCountByTenant.get(t.id) ?? 0,
    studentCount: studentCountByTenant.get(t.id) ?? 0,
    classCount: classCountByTenant.get(t.id) ?? 0,
    monthBilling: billingByTenant.get(t.id) ?? 0,
    monthInvoiceCount: invoiceCountByTenant.get(t.id) ?? 0,
  }));
});

export type TenantPlanStats = { total: number; free: number; paid: number; thisMonthNew: number };

/**
 * 학원 목록 Stat 카드용 경량 집계 — 테넌트 plan·created_at만(무거운 user/student/invoice 조인 없이).
 * 테넌트 모집단은 작지만 1000행 한도 대비 fetchAllPaged.
 */
export async function getTenantPlanStats(): Promise<TenantPlanStats> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const rows = await fetchAllPaged<{ plan: string; created_at: string }>((from, to) =>
    admin.from("tenants").select("plan, created_at").order("id").range(from, to),
  );
  const thisMonth = kstMonth();
  let free = 0;
  let thisMonthNew = 0;
  for (const t of rows) {
    if (t.plan === "free") free += 1;
    if (kstMonth(new Date(t.created_at)) === thisMonth) thisMonthNew += 1;
  }
  return { total: rows.length, free, paid: rows.length - free, thisMonthNew };
}

/**
 * 학원 목록 서버 페이지네이션 — q(name·slug ilike)·plan(eq)을 SQL로, .range + count:exact로 50행씩.
 * 카운트(사용자·학생·청구)는 그 페이지 테넌트 id로만 .in() 스코프 + fetchAllPaged(전건 aggregate·1000행 절단 회피).
 */
export async function getTenantsPage(
  filter: { q?: string; plan?: string },
  page = 1,
  pageSize = 50,
): Promise<{ rows: TenantRow[]; total: number }> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const period = currentPeriod();
  const from = (page - 1) * pageSize;

  let tq = admin
    .from("tenants")
    .select("id, slug, name, plan, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + pageSize - 1);
  if (filter.plan && filter.plan !== "all") tq = tq.eq("plan", filter.plan);
  const term = filter.q?.trim();
  if (term) tq = tq.or(`name.ilike.%${term}%,slug.ilike.%${term}%`);

  const { data, count, error } = await tq;
  if (error) throw new Error(`getTenantsPage: ${error.message}`);
  const tenants = data ?? [];
  const ids = tenants.map((t) => t.id);

  const notStartedP = ids.length === 0 ? Promise.resolve(new Map<string, number>()) : notStartedCountByTenant(admin, ids);
  notStartedP.catch(() => {}); // 아래 Promise.all이 먼저 던지면 이 거부가 처리되지 않은 채 남는다 — 실패는 await에서 다시 던져진다
  const [users, students, classes, invoices] =
    ids.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          fetchAllPaged<{ tenant_id: string }>((f, t) =>
            admin.from("users").select("tenant_id").in("tenant_id", ids).order("id").range(f, t),
          ),
          fetchAllPaged<{ tenant_id: string }>((f, t) =>
            admin.from("students").select("tenant_id").eq("status", "enrolled").in("tenant_id", ids).order("id").range(f, t),
          ),
          fetchAllPaged<{ tenant_id: string }>((f, t) =>
            admin.from("classes").select("tenant_id").eq("is_active", true).in("tenant_id", ids).order("id").range(f, t),
          ),
          fetchAllPaged<{ tenant_id: string; amount_total: number | string | null }>((f, t) =>
            admin.from("invoices").select("tenant_id, amount_total").eq("period", period).neq("status", "void").in("tenant_id", ids).order("id").range(f, t),
          ),
        ]);

  const userCountByTenant = new Map<string, number>();
  users.forEach((u) => userCountByTenant.set(u.tenant_id, (userCountByTenant.get(u.tenant_id) ?? 0) + 1));
  const studentCountByTenant = new Map<string, number>();
  students.forEach((s) => studentCountByTenant.set(s.tenant_id, (studentCountByTenant.get(s.tenant_id) ?? 0) + 1));
  // 실시간 재원생 — 아직 한 과목도 시작 안 한 학생은 뺀다(운영실·원생목록과 같은 규칙, notStartedCountByTenant).
  for (const [t, n] of await notStartedP) studentCountByTenant.set(t, Math.max(0, (studentCountByTenant.get(t) ?? 0) - n));
  const classCountByTenant = new Map<string, number>();
  classes.forEach((c) => classCountByTenant.set(c.tenant_id, (classCountByTenant.get(c.tenant_id) ?? 0) + 1));
  const billingByTenant = new Map<string, number>();
  const invoiceCountByTenant = new Map<string, number>();
  invoices.forEach((i) => {
    billingByTenant.set(i.tenant_id, (billingByTenant.get(i.tenant_id) ?? 0) + Number(i.amount_total ?? 0));
    invoiceCountByTenant.set(i.tenant_id, (invoiceCountByTenant.get(i.tenant_id) ?? 0) + 1);
  });

  const rows = tenants.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    plan: t.plan,
    createdAt: t.created_at,
    userCount: userCountByTenant.get(t.id) ?? 0,
    studentCount: studentCountByTenant.get(t.id) ?? 0,
    classCount: classCountByTenant.get(t.id) ?? 0,
    monthBilling: billingByTenant.get(t.id) ?? 0,
    monthInvoiceCount: invoiceCountByTenant.get(t.id) ?? 0,
  }));

  return { rows, total: exactCount(count, "getTenantsPage") };
}

export type TenantDetail = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
  users: { id: string; email: string; displayName: string; systemRole: string; status: string }[];
  studentCount: number;
  classCount: number;
  monthBilling: number;
  monthInvoiceCount: number;
};

export const getTenantDetail = cache(async (id: string): Promise<TenantDetail | null> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const period = currentPeriod();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, slug, name, plan, created_at")
    .eq("id", id)
    .maybeSingle();
  if (tenantError) throw new Error(`getTenantDetail: ${tenantError.message}`);
  if (!tenant) return null;

  const notStartedP = notStartedCountByTenant(admin, [id]);
  notStartedP.catch(() => {}); // 아래 Promise.all이 먼저 던지면 이 거부가 처리되지 않은 채 남는다 — 실패는 await에서 다시 던져진다
  const [users, studentsRes, classesRes, invoices] = await Promise.all([
    fetchAllPaged<{ id: string; email: string; display_name: string; system_role: string; status: string }>((from, to) =>
      admin.from("users").select("id, email, display_name, system_role, status").eq("tenant_id", id)
        .order("created_at", { ascending: true }).order("id").range(from, to),
    ),
    admin.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("status", "enrolled"),
    admin.from("classes").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("is_active", true),
    fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("amount_total").eq("tenant_id", id).eq("period", period).neq("status", "void").order("id").range(from, to),
    ),
  ]);
  if (studentsRes.error) throw new Error(`getTenantDetail: ${studentsRes.error.message}`);
  if (classesRes.error) throw new Error(`getTenantDetail: ${classesRes.error.message}`);

  const monthBilling = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    createdAt: tenant.created_at,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      systemRole: u.system_role,
      status: u.status,
    })),
    studentCount: Math.max(0, exactCount(studentsRes.count, "getTenantDetail students") - ((await notStartedP).get(id) ?? 0)),
    classCount: exactCount(classesRes.count, "getTenantDetail classes"),
    monthBilling,
    monthInvoiceCount: invoices.length,
  };
});

export const getSaaSStats = cache(async (): Promise<SaaSStats> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const period = currentPeriod();

  const notStartedP = notStartedCountByTenant(admin);
  notStartedP.catch(() => {}); // 아래 Promise.all이 먼저 던지면 이 거부가 처리되지 않은 채 남는다 — 실패는 await에서 다시 던져진다
  const [tenantsRes, usersRes, studentsRes, invoices] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }),
    admin.from("users").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("students").select("id", { count: "exact", head: true }).eq("status", "enrolled"),
    fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("amount_total").eq("period", period).neq("status", "void").order("id").range(from, to),
    ),
  ]);

  for (const result of [tenantsRes, usersRes, studentsRes]) {
    if (result.error) throw new Error(`getSaaSStats: ${result.error.message}`);
  }

  const monthBillingSum = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    tenantCount: exactCount(tenantsRes.count, "getSaaSStats tenants"),
    userCount: exactCount(usersRes.count, "getSaaSStats users"),
    studentCount: Math.max(
      0,
      exactCount(studentsRes.count, "getSaaSStats students") - [...(await notStartedP).values()].reduce((a, b) => a + b, 0),
    ),
    monthBillingSum,
  };
});

export type TenantLicenseRow = {
  id: string;
  feature: string;
  maxSeats: number | null;
  usedSeats: number;
  isActive: boolean;
  expiresAt: string | null;
};

// 좌석형·토글형 기능 정의(라벨 포함)는 `../labels.ts`(SEAT_FEATURES·TOGGLE_FEATURES) 단일 소스. DB에 없으면 "미설정"으로 표시.
export const getTenantLicenses = cache(async (tenantId: string): Promise<TenantLicenseRow[]> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_licenses")
    .select("id, feature, max_seats, used_seats, is_active, expires_at")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`getTenantLicenses: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    feature: r.feature,
    maxSeats: r.max_seats,
    usedSeats: r.used_seats,
    isActive: r.is_active,
    expiresAt: r.expires_at,
  }));
});

export type TenantSnapshot = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  kpi: { students: number; teachers: number; activeClasses: number; monthBilling: number };
  recentStudents: { id: string; name: string; grade: string | null; status: string }[];
  recentMeetings: { id: string; title: string; heldAt: string | null }[];
};

// 지점장 보기(read-only 미러)용 — 그 학원의 현황을 service_role로 읽어 요약.
export const getTenantSnapshot = cache(async (id: string): Promise<TenantSnapshot | null> => {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const period = currentPeriod();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, slug, plan")
    .eq("id", id)
    .maybeSingle();
  if (tenantError) throw new Error(`getTenantSnapshot: ${tenantError.message}`);
  if (!tenant) return null;

  const notStartedP = notStartedCountByTenant(admin, [id]);
  notStartedP.catch(() => {}); // 아래 Promise.all이 먼저 던지면 이 거부가 처리되지 않은 채 남는다 — 실패는 await에서 다시 던져진다
  const [studentsRes, teachersRes, classesRes, invoices, recentStudentsRes, recentMeetingsRes] =
    await Promise.all([
      admin.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("status", "enrolled"),
      admin.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("system_role", "teacher"),
      admin.from("classes").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("is_active", true),
      fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
        admin.from("invoices").select("amount_total").eq("tenant_id", id).eq("period", period).neq("status", "void").order("id").range(from, to),
      ),
      admin
        .from("students")
        .select("id, name, grade, status")
        .eq("tenant_id", id)
        .eq("status", "enrolled")
        .order("created_at", { ascending: false })
        .limit(8),
      admin
        .from("meeting_minutes")
        .select("id, title, held_at")
        .eq("tenant_id", id)
        .order("held_at", { ascending: false })
        .limit(3),
    ]);
  for (const result of [studentsRes, teachersRes, classesRes, recentStudentsRes, recentMeetingsRes]) {
    if (result.error) throw new Error(`getTenantSnapshot: ${result.error.message}`);
  }

  const monthBilling = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    kpi: {
      students: Math.max(0, exactCount(studentsRes.count, "getTenantSnapshot students") - ((await notStartedP).get(id) ?? 0)),
      teachers: exactCount(teachersRes.count, "getTenantSnapshot teachers"),
      activeClasses: exactCount(classesRes.count, "getTenantSnapshot classes"),
      monthBilling,
    },
    recentStudents: (recentStudentsRes.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      status: s.status,
    })),
    recentMeetings: (recentMeetingsRes.data ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      heldAt: m.held_at,
    })),
  };
});
