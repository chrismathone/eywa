import "server-only";
import { unstable_cache } from "next/cache";
import { kstMonth, shiftMonth } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getPortfolioGate } from "@/features/teacher-portfolio/server/queries";
import { isPortfolioTableMissing } from "@/features/teacher-portfolio/server/store";
import { churnCellOf, inTenure, monthSpan, teacherChurnTag, type ChurnMonth, type ChurnTeacherRow, type TeacherChurnData } from "../teacher-churn";
import { loadTenure } from "@/features/teacher-portfolio/server/tenure";

/**
 * 퇴원관리 '강사별 퇴원율 추이' 조회 — 강사평가가 저장한 달(`teacher_portfolio_months`)에서 퇴원율 항목만 읽는다.
 *
 * 🔴 문은 직원 포트폴리오와 같은 `getPortfolioGate()`(원장 역할만) — 강사 한 사람 한 사람의 평가 수치라 퇴원관리를 여는
 *    다른 역할에겐 카드째 없다(null). 값은 저장된 그대로(다시 계산하지 않는다).
 * 🔴 표의 정책이 0개라 admin으로 읽는다 → 모든 조회에 tenant_id(#104). 캐시 안엔 쿠키가 없다(문은 캐시 밖에서 먼저).
 * 🔑 근거(`payload.items`)는 행마다 수십~100KB다. 항목 배열에서 **퇴원율 항목 하나만** 받는다 — 지금 저장 모양에서 퇴원율은
 *    늘 두 번째(`items->1`)라 그 자리부터 받고(침산 12개월 143줄 58ms), id가 다른 줄(설정에서 항목 순서를 바꾼 달)만 항목 id를
 *    훑어 자리를 찾는다(모든 줄을 32자리 훑으면 같은 줄이 600~850ms — jsonb를 자리마다 다시 푼다, 2026-11-11 실측).
 * 🔑 퇴원관리는 필터를 자주 바꾸는 화면이라 이동마다 다시 읽지 않게 지점·달별 5분 캐시(B6) — 강사평가 집계는 하루 한 번이고,
 *    캐시 열쇠에 마지막 집계 시각을 실어 어느 경로로 재집계해도 바로 새 값이다(+ [지금 집계]는 `updateTag(teacherChurnTag)`로도 비운다).
 */
/** 한 번에 받는 달 수 — 기간은 카드 안에서 고른다(받은 달 안에서 바로 바뀐다 · 줄은 강사 × 달이라 가볍다). */
export const CHURN_MONTHS = 36;
/** 항목 id를 확인할 자리 수 — 기본 지표 14 + 직접 만드는 지표 최대 20(`evaluation/config.ts`) = 34 · 여유를 둔다. 넘으면 '확인 불가'. */
const MAX_ITEMS = 40;
const TABLE = "teacher_portfolio_months";

type HeadRow = { teacher_id: string; month: string; closed_at: string | null; subjects: string[] | null; partial: boolean | null; end: string | null; item: unknown };
type ItemRow = { teacher_id: string; month: string; item: unknown };
type Res<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
/** 캐시에 담는 모양 — 과목은 키(라벨은 캐시 밖에서 학원 설정으로). `latestKeys` = 가장 최근 달의 과목. */
type RawChurn = { months: ChurnMonth[]; teachers: (Omit<ChurnTeacherRow, "subjects"> & { latestKeys: string[] })[] };

/** 지금 저장 모양에서 퇴원율 항목의 자리. */
const USUAL = 1;
const ID_SELECT = Array.from({ length: MAX_ITEMS }, (_, i) => `k${i}:payload->items->${i}->>id`).join(",");
const isChurn = (item: unknown) => Boolean(item && typeof item === "object" && (item as { id?: unknown }).id === "churn");
const keyOf = (r: { teacher_id: string; month: string }) => `${r.teacher_id}|${r.month}`;

/** 줄에서 퇴원율 항목이 몇 번째인지 — 없으면 -1. */
function churnIndexOf(r: Record<string, unknown>): number {
  for (let i = 0; i < MAX_ITEMS; i++) if (r[`k${i}`] === "churn") return i;
  return -1;
}

async function readChurn(tenantId: string, to: string): Promise<RawChurn> {
  const admin = createAdminClient();
  const from = shiftMonth(to, -(CHURN_MONTHS - 1));
  const table = () => admin.from(TABLE);
  let heads: HeadRow[];
  try {
    heads = await fetchAllPaged<HeadRow>((a, b) => table()
      .select(`teacher_id, month, closed_at, subjects, partial:payload->partial, end:payload->>end, item:payload->items->${USUAL}`)
      .eq("tenant_id", tenantId).gte("month", from).lte("month", to)
      .order("teacher_id").order("month").range(a, b) as unknown as Res<HeadRow>);
  } catch (e) {
    // 강사평가 표가 아직 없는 지점(SQL 적용 전) — 카드는 '아직 집계 전'으로 선다(#95).
    if (isPortfolioTableMissing({ message: e instanceof Error ? e.message : String(e) })) return { months: [], teachers: [] };
    throw e;
  }
  if (!heads.length) return { months: [], teachers: [] };
  const ids = [...new Set(heads.map((r) => r.teacher_id))];

  // 두 번째 자리가 퇴원율이 아닌 줄만 — 항목 id를 훑어 자리를 찾고, 그 자리의 항목을 다시 받는다(보통 0줄).
  // 거르는 것은 달(12개 이하)뿐 — 강사 id 목록을 주소에 싣지 않는다(B3) · 같은 달의 다른 줄은 JS에서 버린다.
  const odd = heads.filter((r) => !isChurn(r.item));
  const found = new Map<string, unknown>();
  if (odd.length) {
    const oddKeys = new Set(odd.map(keyOf));
    const oddMonths = [...new Set(odd.map((r) => r.month))];
    const scan = await fetchAllPaged<{ teacher_id: string; month: string } & Record<string, unknown>>((a, b) => table()
      .select(`teacher_id, month, ${ID_SELECT}`).eq("tenant_id", tenantId).in("month", oddMonths)
      .order("teacher_id").order("month").range(a, b) as unknown as Res<{ teacher_id: string; month: string } & Record<string, unknown>>);
    const byIndex = new Map<number, Set<string>>();
    let unknown = 0;
    for (const r of scan) {
      if (!oddKeys.has(keyOf(r))) continue;
      const i = churnIndexOf(r);
      if (i < 0) { unknown++; continue; }
      (byIndex.get(i) ?? byIndex.set(i, new Set()).get(i)!).add(keyOf(r));
    }
    if (unknown) reportWarning("퇴원율 항목을 찾지 못한 강사평가 칸", { scope: "loadTeacherChurn", unknown });
    const again = await Promise.all([...byIndex].map(async ([i, keys]) => (await fetchAllPaged<ItemRow>((a, b) => table()
      .select(`teacher_id, month, item:payload->items->${i}`).eq("tenant_id", tenantId).in("month", oddMonths)
      .order("teacher_id").order("month").range(a, b) as unknown as Res<ItemRow>)).filter((r) => keys.has(keyOf(r)))));
    for (const r of again.flat()) found.set(keyOf(r), r.item);
  }
  const users = await fetchInChunks<{ id: string; display_name: string | null; hire_date: string | null; status: string | null }>(ids, (chunk) =>
    admin.from("users").select("id, display_name, hire_date, status").eq("tenant_id", tenantId).in("id", chunk));
  // 재직 기간 = 강사평가 담당 판정과 같은 함수(`loadTenure` — 입사일 · 퇴사일(재입사 전 옛 퇴사는 버림)).
  const tenure = await loadTenure(admin, tenantId);
  const resignOf = new Map([...tenure].flatMap(([id, t]) => (t.resignDate ? [[id, t.resignDate] as const] : [])));
  // 퇴사자 = 직원 상태 inactive(대기 pending은 퇴사가 아니다) — '퇴사자 숨김' 토글이 본다.
  const inactive = new Set(users.filter((u) => u.status === "inactive").map((u) => u.id));
  const itemOf = new Map<string, unknown>(heads.map((r) => [keyOf(r), isChurn(r.item) ? r.item : found.get(keyOf(r))]));
  const nameOf = new Map(users.map((u) => [u.id, u.display_name?.trim() || "이름 없음"]));
  const hireOf = new Map(users.map((u) => [u.id, u.hire_date ?? null]));
  // 재직 밖 달의 줄은 싣지 않는다 — 입사 다음 달 전(입사 전 기록으로 셈한 값) · 퇴사한 달 뒤(그 강사가 없던 동안).
  const kept = heads.filter((r) => nameOf.has(r.teacher_id)
    && inTenure(r.month, hireOf.get(r.teacher_id) ?? null, resignOf.get(r.teacher_id) ?? null));
  if (!kept.length) return { months: [], teachers: [] };

  // 축 = 저장 줄이 있는 첫 달부터 마지막 달까지 빠짐없이 — 줄이 하나도 없는 달도 세워 선이 그 달을 건너뛰어 잇지 않게.
  const have = [...new Set(kept.map((r) => r.month))].sort();
  const months: ChurnMonth[] = monthSpan(have[0]!, have.at(-1)!).map((month) => {
    const rows = kept.filter((r) => r.month === month);
    // 진행 중 = 그 달 줄이 진행 중 표시를 달고 있다 · 반영 끝 날짜는 저장된 집계의 것(오늘로 짐작하지 않는다 · 강사마다 다르면 모두).
    return { month, partial: rows.some((r) => r.partial === true), ends: [...new Set(rows.map((r) => r.end ?? "").filter(Boolean))].sort() };
  });
  // 입사 전 달만 있던 강사(이번 달 입사 등)는 줄째 없다.
  const teachers = ids.filter((id) => kept.some((r) => r.teacher_id === id)).map((id) => {
    const mine = kept.filter((r) => r.teacher_id === id);
    return {
      id, name: nameOf.get(id)!, hireDate: hireOf.get(id) ?? null, resignDate: resignOf.get(id) ?? null, resigned: inactive.has(id),
      // 줄 머리 과목 = 가장 최근 달에 가르친 과목(그 달 수업이 없으면 그 앞 달) · 과목 필터 = 보이는 달들에 가르친 과목 전부.
      latestKeys: [...mine].reverse().find((r) => (r.subjects ?? []).length)?.subjects ?? [],
      subjectsByMonth: Object.fromEntries(mine.map((r) => [r.month, r.subjects ?? []])),
      // 저장 줄이 있는 달만 칸이 선다 — 항목을 못 읽은 줄은 '확인 불가'(빈 칸·0%로 위장하지 않는다).
      cells: Object.fromEntries(mine.map((r) => [r.month, churnCellOf(itemOf.get(keyOf(r)), Boolean(r.closed_at), r.end ?? "")])),
    };
  });
  return { months, teachers };
}

/** 원장 역할이 아니면 null. 표가 없거나 집계 전이면 빈 표. 조회가 실패하면 던진다(카드가 '불러오지 못함'으로 말한다). */
export async function loadTeacherChurn(now: Date = new Date()): Promise<TeacherChurnData | null> {
  const gate = await getPortfolioGate();
  if (!gate) return null;
  const to = kstMonth(now);
  // 캐시 열쇠에 저장된 집계의 마지막 시각을 싣는다 — 매일 cron·[지금 집계]·설정 저장 뒤 재집계 어느 경로든 새 저장이 생기면 바로 새 값
  // (직원 포트폴리오와 숫자가 갈리지 않게 · Codex 리뷰 2026-11-11). 시각 한 칸만 읽는 가벼운 조회다.
  const { data: latest } = await createAdminClient().from(TABLE).select("computed_at").eq("tenant_id", gate.tenantId)
    .order("computed_at", { ascending: false }).limit(1).maybeSingle();
  const version = (latest as { computed_at?: string } | null)?.computed_at ?? "none";
  const [raw, settings] = await Promise.all([
    unstable_cache(() => readChurn(gate.tenantId, to), ["withdrawals-teacher-churn-v5", gate.tenantId, to, version],
      { revalidate: 300, tags: [teacherChurnTag(gate.tenantId)] })(),
    getTenantSettings(),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 라벨을 못 찾는 과목 키(설정에서 지운 과목 등)는 키 원문을 내보내지 않고 뺀다 — 화면에 raw 코드 금지.
  const labelsOf = (keys: string[]) => keys.flatMap((k) => { const l = subjects.labelOf(k); return l && l !== k ? [l] : []; });
  return {
    months: raw.months,
    teachers: raw.teachers.map(({ latestKeys, ...t }) => ({ ...t, subjects: labelsOf(latestKeys) })),
  };
}
