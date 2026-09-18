import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { sessionPriceOf, type SessionPriceTerm, type TierRow } from "@/features/payroll/tier-settlement";
import { autoSalaryGroup, isSalaryGroup, type SalaryGroup } from "@/features/payroll/salary-group";
import { programOf, type ProgramSubject } from "@/features/students/program";

/**
 * 티어 정산 **입력 행 조립** — (학생 × 반 × 티어)의 그 달 시수 합.
 *
 * 🔴 왜 따로 뺐나: 출석부 하단 정산액(teacher-money.ts)과 급여명세서(payslip-queries.ts)가
 *    **같은 숫자**를 말해야 한다. 조립을 두 벌로 두면 언젠가 한쪽만 고쳐져 "화면 금액과
 *    명세서 금액이 다르다"가 된다 — 돈 화면에서 가장 나쁜 종류의 버그다.
 *    (원본은 teacher-money.ts의 computeTierSettlementInfo 안에 있던 지역 로직이고,
 *     동작을 **그대로** 옮겼다. 시트 대조 실측치 4인은 이 조립 결과에 걸려 있다.)
 *
 * 규칙(전부 원본 그대로):
 * · 시수 = attendance_records **교시별 유효행**(0196a slot_start — 같은 날 두 교시면 두 행 다 센다).
 * · 결석·excused는 시수를 소비하지 않는다. session_units null = 1.
 * · 티어 = 기록 예외(attendance_records.salary_tier) ?? 수강(enrollments.salary_tier).
 * · class_salary_settings.applies_dows가 지정된 반은 **그 요일 출결만** 정산에 넣는다
 *   (이성우 = 주말만 급여. 출결 자체는 진실로 남고 급여만 거른다).
 * · "그 달" = 달력월(세션 아님) — 시트가 달력월이라 여기서도 달력월이다.
 * · 🔑 **단가 = 회차 확정 단가 우선**(원장 2026-09-18 — 수학 반만): 그 달 청구서(`invoices.period` = 달력월, void 제외)의
 *   회차 행이 전부 확정·시수 기준이면 그 단가를 줄에 싣는다(`sessionPriceOf`). 없으면 종전대로 티어.
 *   🔴 **기록 예외 티어 줄엔 안 붙인다** — 같은 반 안에서 일부 교시만 다른 티어(교시 분리 0.5T)로 적은 것은 사람이
 *      그 기록에 직접 정한 값이다. 회차 단가는 학생×반 하나라 그 차이를 표현하지 못한다.
 *   🔴 **영어는 대상이 아니다**(원장 선택) — 영어 반엔 티어가 0건이라, 붙이면 영어 강사 정산액이 처음으로 생긴다.
 */
export type TierRowsResult = {
  rows: TierRow[];
  /** 티어 라벨 → 회당 단가(원). master 전용 RLS라 비-master 세션에선 비어 있다. */
  priceByTier: Map<string, number>;
  /** 학생 → 티어 라벨 표시용(여럿이면 " · " join). 금액 아님. */
  tierByStudent: Record<string, string>;
  /** 학생 id → 이름(정산에 들어간 전원). */
  nameById: Map<string, string>;
};

const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** 달력월 경계 — 'YYYY-MM' → ['YYYY-MM-01', 'YYYY-MM-말일']. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10),
  };
}

/**
 * 조립 실행. **null = 산정 불가**(0199a 미적용 · 단가표 0행 · 반 없음 · 시수 0) —
 * 호출부가 "unwired"로 접을지 에러로 올릴지 정한다. 여기서 0원을 지어내지 않는다.
 *
 * ⚠️ 0199a 스키마가 없으면 PostgREST 400 → 헬퍼가 throw한다. 이 함수는 **삼키지 않고 그대로 던진다** —
 *    출석부는 화면을 살리려고 catch하지만, 명세서는 0원짜리 문서를 뽑느니 실패해야 하기 때문이다.
 */
export async function collectTierRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  month: string,
  classIds: string[],
  /**
   * 🔴 **admin 클라이언트로 부를 때는 필수**다. admin은 RLS를 우회하므로 단가표를 테넌트로 안 걸면
   *    다른 학원의 단가까지 읽어 라벨이 겹치는 순간 남의 금액으로 급여를 계산한다.
   *    세션 클라이언트(출석부 경로)는 RLS가 이미 테넌트를 가르므로 생략해도 안전하다.
   */
  tenantId: string | undefined,
  /** 학원설정 과목(`operations.subjects`) — 회차 단가를 붙일 **수학 반** 판정(`programOf`, 수학(심화) 포함). */
  subjects: readonly ProgramSubject[],
): Promise<TierRowsResult | null> {
  if (classIds.length === 0) return null;
  const { from, to } = monthBounds(month);

  const tierQuery = supabase.from("salary_tiers").select("label, unit_price");

  const [tiers, tierEnrollments, records, dowSettings, classMeta, sessionTerms] = await Promise.all([
    tenantId ? tierQuery.eq("tenant_id", tenantId) : tierQuery,
    fetchInChunks<{ student_id: string; class_id: string; salary_tier: string | null }>(classIds, (chunk) =>
      supabase.from("enrollments").select("student_id, class_id, salary_tier").in("class_id", chunk),
    ),
    fetchAllPagedInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      session_date: string;
      slot_start: string | null;
      status: string;
      session_units: number | string | null;
      salary_tier: string | null;
      seat_label: string | null;
      recorded_at: string;
    }>(classIds, (chunk, f, t) =>
      supabase
        .from("attendance_records")
        .select(
          "id, student_id, class_id, session_date, slot_start, status, session_units, salary_tier, seat_label, recorded_at",
        )
        .in("class_id", chunk)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id", { ascending: true }) // OFFSET 페이지 안정용 unique 정렬(B2)
        .range(f, t),
    ),
    fetchInChunks<{ class_id: string; applies_dows: string[] | null; salary_group: string | null }>(classIds, (chunk) =>
      supabase.from("class_salary_settings").select("class_id, applies_dows, salary_group").in("class_id", chunk),
    ),
    // 반 과목·이름 — 수학 반 판정(회차 단가 대상)과 반 과정(특강 판정) 재료.
    fetchInChunks<{ id: string; class_name: string | null; subject: string | null; english_track: string | null }>(
      classIds,
      (chunk) => {
        const q = supabase.from("classes").select("id, class_name, subject, english_track").in("id", chunk);
        return tenantId ? q.eq("tenant_id", tenantId) : q;
      },
    ),
    // 그 달 회차 행(반 기준) — 청구서는 **컬럼 힌트** 임베드(`invoice:invoice_id`, [[#94]])로 달·학생을 함께 받는다.
    // 🔴 청구서는 void 제외 · 그 달(`period`)만 — 회차 확정 화면과 같은 집합.
    fetchAllPagedInChunks<
      SessionPriceTerm & {
        class_id: string | null;
        invoice: { student_id: string } | { student_id: string }[] | null;
      }
    >(classIds, (chunk, f, t) => {
      const q = supabase
        .from("invoice_session_terms")
        .select(
          "class_id, confirmed_sessions, unit_price, pricing_mode, quantity_basis, invoice:invoice_id!inner ( student_id, period, status )",
        )
        .in("class_id", chunk)
        .eq("invoice.period", month)
        .neq("invoice.status", "void");
      return (tenantId ? q.eq("tenant_id", tenantId) : q).order("id", { ascending: true }).range(f, t);
    }),
  ]);

  if (tiers.error) return null;
  const priceByTier = new Map<string, number>(
    (tiers.data ?? []).map((t) => [t.label as string, Number(t.unit_price)]),
  );
  if (priceByTier.size === 0) return null;

  // 수강 티어: 같은 (학생, 반)에 재등록 행이 여럿이면 티어가 지정된 행 우선(백필은 전 행에 같은 값을 쓴다).
  const enrollTier = new Map<string, string>();
  const tierSetByStudent = new Map<string, Set<string>>();
  const addTier = (studentId: string, tier: string) => {
    (tierSetByStudent.get(studentId) ?? tierSetByStudent.set(studentId, new Set()).get(studentId)!).add(tier);
  };
  for (const e of tierEnrollments) {
    if (e.salary_tier) {
      enrollTier.set(`${e.student_id}|${e.class_id}`, e.salary_tier);
      addTier(e.student_id, e.salary_tier);
    }
  }

  const appliesDowsByClass = new Map<string, Set<string>>();
  const manualGroupByClass = new Map<string, SalaryGroup>();
  for (const s of dowSettings) {
    if (s.applies_dows && s.applies_dows.length > 0) appliesDowsByClass.set(s.class_id, new Set(s.applies_dows));
    if (isSalaryGroup(s.salary_group)) manualGroupByClass.set(s.class_id, s.salary_group);
  }

  // 반 과정(수동 지정 ?? 반 이름) · 수학 반 집합.
  const classGroupOf = new Map<string, SalaryGroup | null>();
  const mathClassIds = new Set<string>();
  for (const c of classMeta) {
    classGroupOf.set(c.id, manualGroupByClass.get(c.id) ?? autoSalaryGroup(c.class_name));
    if (programOf({ subject: c.subject, english_track: c.english_track }, subjects) === "math") mathClassIds.add(c.id);
  }

  // 학생×반 → 그 달 회차 행들 → 정산에 쓸 회차 단가(전부 확정·시수 기준·한 단가일 때만).
  const termsByRow = new Map<string, SessionPriceTerm[]>();
  for (const t of sessionTerms) {
    const inv = Array.isArray(t.invoice) ? t.invoice[0] : t.invoice;
    if (!t.class_id || !inv?.student_id || !mathClassIds.has(t.class_id)) continue;
    const k = `${inv.student_id}|${t.class_id}`;
    (termsByRow.get(k) ?? termsByRow.set(k, []).get(k)!).push(t);
  }
  const sessionPriceByRow = new Map<string, number>();
  for (const [k, list] of termsByRow) {
    const p = sessionPriceOf(list);
    if (p !== null) sessionPriceByRow.set(k, p);
  }

  const effective = effectiveAttendanceRecords(records);
  const unitsByRow = new Map<string, { studentId: string; classId: string; tierLabel: string | null; units: number }>();
  for (const r of effective) {
    if (r.status === "absent" || r.status === "excused") continue;
    // 자리(랩실·JJ실) 수업은 **담임 시수가 아니다**(원장 2026-08-14 "담임 시수로 잡히는게 아니라 별도
    // 시수로 잡힘", 0208a). 출결 자체는 그 반 기록으로 남아 반 출석부에 그대로 보이지만, 정산 분모에선
    // 뺀다 — 자리 시수는 자리 축으로 따로 센다.
    if (r.seat_label) continue;
    const applies = appliesDowsByClass.get(r.class_id);
    if (applies && !applies.has(DOW_KEYS[new Date(`${r.session_date}T00:00:00Z`).getUTCDay()]!)) continue;
    const u = r.session_units === null || r.session_units === undefined ? 1 : Number(r.session_units);
    if (!Number.isFinite(u) || u <= 0) continue;
    const tierLabel = r.salary_tier ?? enrollTier.get(`${r.student_id}|${r.class_id}`) ?? null;
    if (r.salary_tier) addTier(r.student_id, r.salary_tier); // 기록 예외(교시 분리 0.5T)도 표시에 포함
    const key = `${r.student_id}|${r.class_id}|${tierLabel ?? ""}`;
    const cur = unitsByRow.get(key) ?? { studentId: r.student_id, classId: r.class_id, tierLabel, units: 0 };
    cur.units += u;
    unitsByRow.set(key, cur);
  }
  if (unitsByRow.size === 0) return null;

  // ⚠️ 원본은 "단가 미지정" 명단에 쓸 이름만 받았지만, 명세서는 **전원 이름**이 필요하다(수업 내역 표).
  //    computeTierSettlement은 studentName을 미지정 명단에만 쓰므로 전원을 채워도 금액은 불변이다.
  const allIds = [...new Set([...unitsByRow.values()].map((r) => r.studentId))];
  const named = await fetchInChunks<{ id: string; name: string }>(allIds, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map<string, string>(named.map((n) => [n.id, n.name]));

  return {
    rows: [...unitsByRow.values()].map((r) => {
      const rowKey = `${r.studentId}|${r.classId}`;
      // 기록 예외 티어 줄(수강 티어와 다른 라벨)엔 회차 단가를 안 붙인다 — 위 머리 주석.
      const recordException = r.tierLabel !== null && r.tierLabel !== (enrollTier.get(rowKey) ?? null);
      return {
        studentId: r.studentId,
        studentName: nameById.get(r.studentId) ?? "",
        classId: r.classId,
        tierLabel: r.tierLabel,
        units: r.units,
        sessionPrice: recordException ? null : (sessionPriceByRow.get(rowKey) ?? null),
        classGroup: classGroupOf.get(r.classId) ?? null,
      };
    }),
    priceByTier,
    tierByStudent: Object.fromEntries([...tierSetByStudent].map(([id, set]) => [id, [...set].join(" · ")])),
    nameById,
  };
}
