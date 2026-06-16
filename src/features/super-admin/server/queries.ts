import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
  userCount: number;
  studentCount: number;
  monthBilling: number;
};

export type SaaSStats = {
  tenantCount: number;
  userCount: number;
  studentCount: number;
  monthBillingSum: number;
};

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// 전체 tenant 목록 + 카운트. multi-tenant read이므로 service_role 사용.
export const getAllTenants = cache(async (): Promise<TenantRow[]> => {
  const admin = createAdminClient();
  const period = currentPeriod();

  // users/students/invoices는 전 테넌트 전건을 가져와 JS로 집계 → PostgREST 1000행 한도에
  // silent 절단되면 카운트·청구가 과소된다. 페이지네이션으로 전건 확보(테넌트 증가 대비).
  const [tenantsRes, users, students, invoices] = await Promise.all([
    admin.from("tenants").select("id, slug, name, plan, created_at").order("created_at", { ascending: false }),
    fetchAllPaged<{ tenant_id: string }>((from, to) =>
      admin.from("users").select("tenant_id").range(from, to),
    ),
    fetchAllPaged<{ tenant_id: string }>((from, to) =>
      admin.from("students").select("tenant_id").neq("status", "withdrawn").range(from, to),
    ),
    fetchAllPaged<{ tenant_id: string; amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("tenant_id, amount_total").eq("period", period).range(from, to),
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

  const billingByTenant = new Map<string, number>();
  invoices.forEach((i) => {
    const amt = Number(i.amount_total ?? 0);
    billingByTenant.set(i.tenant_id, (billingByTenant.get(i.tenant_id) ?? 0) + amt);
  });

  return (tenantsRes.data ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    plan: t.plan,
    createdAt: t.created_at,
    userCount: userCountByTenant.get(t.id) ?? 0,
    studentCount: studentCountByTenant.get(t.id) ?? 0,
    monthBilling: billingByTenant.get(t.id) ?? 0,
  }));
});

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
  const admin = createAdminClient();
  const period = currentPeriod();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, name, plan, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) return null;

  const [usersRes, studentsRes, classesRes, invoices] = await Promise.all([
    admin
      .from("users")
      .select("id, email, display_name, system_role, status")
      .eq("tenant_id", id)
      .order("created_at", { ascending: true }),
    admin.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", id).neq("status", "withdrawn"),
    admin.from("classes").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("is_active", true),
    fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("amount_total").eq("tenant_id", id).eq("period", period).range(from, to),
    ),
  ]);

  const monthBilling = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    createdAt: tenant.created_at,
    users: (usersRes.data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      systemRole: u.system_role,
      status: u.status,
    })),
    studentCount: studentsRes.count ?? 0,
    classCount: classesRes.count ?? 0,
    monthBilling,
    monthInvoiceCount: invoices.length,
  };
});

export const getSaaSStats = cache(async (): Promise<SaaSStats> => {
  const admin = createAdminClient();
  const period = currentPeriod();

  const [tenantsRes, usersRes, studentsRes, invoices] = await Promise.all([
    admin.from("tenants").select("id", { count: "exact", head: true }),
    admin.from("users").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("students").select("id", { count: "exact", head: true }).neq("status", "withdrawn"),
    fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
      admin.from("invoices").select("amount_total").eq("period", period).range(from, to),
    ),
  ]);

  const monthBillingSum = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    tenantCount: tenantsRes.count ?? 0,
    userCount: usersRes.count ?? 0,
    studentCount: studentsRes.count ?? 0,
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

// 좌석형 + 토글형 기능 정의 (UI 렌더 기준). DB에 없으면 "미설정"으로 표시.
export const SEAT_FEATURES = [{ key: "student_seats", label: "재원생 좌석" }] as const;
export const TOGGLE_FEATURES = [
  { key: "ai_analysis", label: "AI 분석" },
  { key: "google_sheets", label: "Google Sheets 연동" },
  { key: "meeting_recording", label: "회의 녹음·전사" },
] as const;

export const getTenantLicenses = cache(async (tenantId: string): Promise<TenantLicenseRow[]> => {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_licenses")
    .select("id, feature, max_seats, used_seats, is_active, expires_at")
    .eq("tenant_id", tenantId);
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
  const admin = createAdminClient();
  const period = currentPeriod();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, plan")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) return null;

  const [studentsRes, teachersRes, classesRes, invoices, recentStudentsRes, recentMeetingsRes] =
    await Promise.all([
      admin.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", id).neq("status", "withdrawn"),
      admin.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("system_role", "teacher"),
      admin.from("classes").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("is_active", true),
      fetchAllPaged<{ amount_total: number | string | null }>((from, to) =>
        admin.from("invoices").select("amount_total").eq("tenant_id", id).eq("period", period).range(from, to),
      ),
      admin
        .from("students")
        .select("id, name, grade, status")
        .eq("tenant_id", id)
        .neq("status", "withdrawn")
        .order("created_at", { ascending: false })
        .limit(8),
      admin
        .from("meeting_minutes")
        .select("id, title, held_at")
        .eq("tenant_id", id)
        .order("held_at", { ascending: false })
        .limit(3),
    ]);

  const monthBilling = invoices.reduce((sum, i) => sum + Number(i.amount_total ?? 0), 0);

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan,
    kpi: {
      students: studentsRes.count ?? 0,
      teachers: teachersRes.count ?? 0,
      activeClasses: classesRes.count ?? 0,
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
