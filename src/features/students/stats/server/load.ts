import "server-only";
import { kstToday } from "@/lib/date-kst";

/** 시각(UTC) → KST 달(YYYY-MM). */
const kstMonthOf = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7);
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/program";
import { getWithdrawalsInWindow } from "@/features/withdrawals/server/window";
import { loadMonthlyChanges } from "@/features/dashboard/overview/server";
import { monthKeys } from "@/features/dashboard/overview/model";
import { loadViewerBundle } from "@/features/dashboard/layout/viewer-server";
import { selectSubjectView } from "@/features/dashboard/layout/subject-view";
import { sliceGroupsOf, slicePredicate, type SlicePredicate } from "@/features/dashboard/layout/slices";
import { DETAIL_MONTHS, loadEnrolledTrendDetail, type EnrolledTrendDetail } from "@/features/dashboard/overview/enrolled-trend-server";
import { parseStudentStatsPrefs, type FlowRow, type StudentStatsPrefs } from "../model";

/** 한 구역의 결과 — 실패는 0이 아니라 '못 불러옴'으로(운영실 Section과 같은 뜻). */
export type Part<T> = { data: T; error: false } | { data: null; error: true };

/**
 * 과목 범위 보기 — 운영실과 같다: 과목 관리자 화면(`bundle === "subject"`)은 한 번에 한 과목 묶음(`selectSubjectView` · 담당이 여럿이면
 * 전환), 그 밖의 과목 범위 계정은 담당 과목 전체(합집합 · 전환 없음).
 */
export type StatsSubjectScope = { label: string; active: string | null; choices: { key: string; label: string }[] };

export type StudentStats = {
  today: string;
  prefs: StudentStatsPrefs;
  /**
   * 강사 범위 — 통계를 보이지 않는다. 퇴원은 학생 범위로 거를 수 없어(퇴원생은 담당 반을 떠났다) 학원 전체 퇴원이 섞이고,
   * 강사에겐 퇴원관리·운영실 권한이 없다(리뷰 2026-10-20).
   */
  teacherScoped: boolean;
  /** 과목 관리자면 그 보기, 아니면 null. */
  scope: StatsSubjectScope | null;
  /** 과목 관리자인데 담당 과목이 비었다(운영실도 숫자를 안 보인다). */
  scopeEmpty: boolean;
  /**
   * 정확히 셀 수 있는 아래 경계(YYYY-MM · 오늘 이전 기록만) — 퇴원 기록 시작 · 수강 종료 첫 기록 · 지점이 에이와를 시작한 달
   * (퇴원·수강 종료 기록이 아직 없는 새 지점·이관 지점의 아래 경계 — 그 전의 상승 곡선은 떠난 학생이 빠진 거짓이다).
   */
  bounds: { recordsFrom: string | null; breakdownFrom: string | null; createdMonth: string | null };
  flow: Part<FlowRow[]> | null;
  trend: Part<EnrolledTrendDetail> | null;
};

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type Settings = Awaited<ReturnType<typeof getTenantSettings>>;

async function part<T>(scope: string, load: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await load(), error: false };
  } catch (error) {
    console.error(`[students/stats/${scope}]`, error);
    return { data: null, error: true };
  }
}

/**
 * 아래 경계 둘 — 가장 이른 퇴원일의 달(재원생·순증을 셀 수 있는 시작) · 가장 이른 수강 종료일의 달(과목을 가를 수 있는 시작).
 * 🔴 **오늘 이전 기록만** — 퇴원 예약·반이동 예약의 미래 날짜가 경계가 되면 화면이 통째로 빈다(리뷰 2026-10-20).
 * 한 줄씩만 읽는다 · RLS 우회(admin)라 `tenant_id`까지 좁힌다([[#104]]).
 */
async function loadBounds(tenantId: string, today: string): Promise<StudentStats["bounds"]> {
  const admin = createAdminClient();
  const [out, end, tenant] = await Promise.all([
    admin.from("students").select("withdrawn_at").eq("tenant_id", tenantId).not("withdrawn_at", "is", null).lte("withdrawn_at", `${today}T23:59:59+09:00`).order("withdrawn_at", { ascending: true }).limit(1),
    admin.from("enrollments").select("end_date").eq("tenant_id", tenantId).not("end_date", "is", null).lte("end_date", today).order("end_date", { ascending: true }).limit(1),
    admin.from("tenants").select("created_at").eq("id", tenantId).maybeSingle(),
  ]);
  if (out.error) throw out.error;
  if (end.error) throw end.error;
  if (tenant.error) throw tenant.error;
  const w = (out.data?.[0] as { withdrawn_at: string | null } | undefined)?.withdrawn_at;
  const e = (end.data?.[0] as { end_date: string | null } | undefined)?.end_date;
  const c = (tenant.data as { created_at: string | null } | null)?.created_at;
  return { recordsFrom: w ? w.slice(0, 7) : null, breakdownFrom: e ? e.slice(0, 7) : null, createdMonth: c ? kstMonthOf(c) : null };
}

/**
 * 과목 관리자 판정 — 운영실과 **같은 재료·같은 함수**: `loadViewerBundle` → `selectSubjectView`(한 번에 한 묶음 · `?subject=` 전환) →
 * 묶음(`subjectGroupOf`) → `slicePredicate(묶음, sliceGroupsOf)`(server.ts `loadOverview`의 과목별 값과 같은 줄). 과목 관리자가 아니면 null.
 * 담당 과목을 못 읽으면(`degraded`) 넓히지 않고 던진다 · 담당 과목이 비면 `empty`(운영실처럼 숫자를 안 낸다).
 */
async function subjectScopeOf(user: User, settings: Settings, requested?: string) {
  const viewer = await loadViewerBundle(user);
  if (!viewer.subjectScoped) return null;
  if (viewer.degraded) throw new Error("담당 과목을 확인하지 못했습니다");
  // 판정은 운영실과 **같은 표**(옛 라벨 포함 `subjectLabelRecord`)로 — `loadOverview`의 selectSubjectView·groupOf와 같은 줄(재리뷰 2026-10-20:
  // 학원설정 과목만으로 판정하면 옛 키를 담당으로 가진 계정이 운영실과 갈렸다). 화면 **이름**만 학원설정 과목 이름으로 보인다.
  const labels = subjectLabelRecord(settings.operations.subjects);
  const programSubjects = programSubjectsOf(labels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programSubjects);
  const view = viewer.bundle === "subject" ? selectSubjectView(labels, viewer.subjects, requested) : null;
  const viewing = view ? view.subjects : viewer.subjects.filter((k) => !!labels[k]);
  // 운영실처럼: 과목 관리자 화면은 고를 묶음이 없으면, 그 밖의 계정은 라벨 있는 담당 과목이 하나도 없으면 숫자를 내지 않는다(view.ts '공지만').
  if ((view && !view.active) || viewing.length === 0) return { empty: true as const };
  const groups = [...new Set(viewing.map(groupOf).filter((g): g is string => g !== null))];
  const sliceSubjects = settings.operations.subjects.map((s) => ({ key: s.key, label: s.label }));
  const pred: SlicePredicate = slicePredicate(groups, sliceGroupsOf(sliceSubjects, groupOf));
  // 이름 = 학원설정 과목 이름(같은 묶음의 첫 설정 과목) — 옛 키('highmath')를 '수학(심화)'로 보이지 않게.
  const settingsNameOfGroup = (key: string) => {
    const g = groupOf(key);
    return settings.operations.subjects.find((s) => s.key === key)?.label ?? settings.operations.subjects.find((s) => groupOf(s.key) === g)?.label ?? null;
  };
  const label = [...new Set(viewing.flatMap((k) => { const n = settingsNameOfGroup(k); return n ? [n] : []; }))].join("·") || "담당 과목";
  const choices = (view?.choices ?? []).map((c) => ({ key: c.key, label: settingsNameOfGroup(c.key) ?? c.label }));
  return {
    empty: false as const,
    pred,
    scope: { label, active: view?.active?.key ?? null, choices } satisfies StatsSubjectScope,
  };
}

/**
 * 원생 통계 화면 원본 — 운영실 카드와 **같은 함수**(등록·퇴원 `loadMonthlyChanges` · 재원생 추이 `loadEnrolledTrendDetail`)를
 * 더 긴 창으로 부른다. 그래서 오늘 값 = 운영실 카드 값이다. 운영실에 이미 보이는 '지금 구성'은 다시 싣지 않는다
 * (원장 2026-10-20 *"대시보드에서 볼 수 있는건 중복표기 하지말고"*). 과목 관리자는 **자기 과목만**(원장 같은 날 — 운영실과 같은 판정).
 * 구역마다 따로 실패한다(한 구역이 깨져도 나머지는 보인다). 독립 조회는 함께 띄운다(B4).
 * 호출부가 `requireAccess("students")`를 먼저 지난다.
 */
export async function loadStudentStats(requestedSubject?: string): Promise<StudentStats> {
  const today = kstToday();
  const [user, teacherId, prefsRaw, settings] = await Promise.all([getCurrentUser(), effectiveTeacherId(), readMyUiPrefs(), getTenantSettings()]);
  if (!user) throw new Error("로그인이 필요합니다");
  const prefs = parseStudentStatsPrefs(prefsRaw.studentStats);
  const base = { today, prefs, scope: null, scopeEmpty: false, bounds: { recordsFrom: null, breakdownFrom: null, createdMonth: null }, flow: null, trend: null };
  if (teacherId) return { ...base, teacherScoped: true };

  const [boundsPart, subjectScope] = await Promise.all([
    part("bounds", () => loadBounds(user.tenantId, today)),
    subjectScopeOf(user, settings, requestedSubject).then(
      (v) => ({ ok: true as const, v }),
      (error: unknown) => {
        console.error("[students/stats/subject-scope]", error);
        return { ok: false as const, v: null };
      },
    ),
  ]);
  const scoped = subjectScope.v && !subjectScope.v.empty ? subjectScope.v : null;
  if (subjectScope.v?.empty) return { ...base, teacherScoped: false, scopeEmpty: true };
  const fail = !subjectScope.ok || boundsPart.error;
  const fromDate = `${monthKeys(today, DETAIL_MONTHS)[0]}-01`;
  const [flow, trend] = await Promise.all([
    part("flow", async () => {
      if (fail) throw new Error("통계 범위를 확인하지 못했습니다");
      const compute = await loadMonthlyChanges(today, null, getWithdrawalsInWindow(fromDate, today), !!scoped, DETAIL_MONTHS, !scoped);
      return compute(scoped?.pred ?? null);
    }),
    part("trend", async () => {
      if (fail) throw new Error("통계 범위를 확인하지 못했습니다");
      return loadEnrolledTrendDetail(
        user.tenantId,
        today,
        settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })),
        scoped?.pred,
      );
    }),
  ]);
  return {
    ...base,
    teacherScoped: false,
    scope: scoped?.scope ?? null,
    bounds: boundsPart.data ?? base.bounds,
    flow,
    trend,
  };
}
