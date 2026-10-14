import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { monthRange, shiftMonth } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { foldedReason } from "@/lib/folded-read";
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";
import { attendanceReadContext } from "./read-context";
import { loadTeacherTermWeights, type TeacherTermScope } from "./teacher-term-share";
import { teacherTermSessions } from "../teacher-term-share";
import { loadMoneyCarryIns, loadMoneyCarryOuts } from "@/features/billing/session-terms/server/money-carryover-queries";
import {
  attendanceCarryMarks,
  attendanceClassBilledDetail,
  attendanceClassConfirmedSessions,
  attendanceClassConfirmedPrices,
  attendanceInvoiceStateByStudent,
  type AttendanceBillingTerm,
  type AttendanceCarryMark,
  type AttendanceInvoice,
  type AttendanceInvoiceState,
  type AttendanceTermSessions,
  type AttendanceConfirmedPrice,
} from "../class-billing";

/**
 * 빈 결과 — 전부 빈 값(열은 그대로 서고 값은 '미확정'으로 뜬다 · 「단가」 표식은 종전대로).
 * 🔴 **매번 새로 만든다** — 모듈 전역 하나를 돌려주면 호출부가 그 객체에 쓰는 순간 요청·테넌트를 넘어 샌다.
 * ⚠️ `invoiceStateByStudent`도 빈 맵이다 — 판정을 안 했으면 '청구서 없음'(`—`)이 아니라 종전 '미확정'이다.
 */
const empty = (): AttendanceClassBilling => ({ billed: {}, confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [], invoiceStateByStudent: {}, carryMarks: {} });

export type AttendanceClassBilling = {
  billed: Record<string, number>;
  confirmedSessions: Record<string, AttendanceTermSessions>;
  confirmedPrices: Record<string, AttendanceConfirmedPrice[]>;
  /** 회차 확정에서 단가까지 확정된 학생×반 줄 — 「단가」 표식을 뗀다(표시 전용, 정산액 불변). */
  priceConfirmed: string[];
  /**
   * 학생 → 그 달 청구서 상태(`ok`·`none`·`void`, 2026-09-18) — 회차 행이 없는 줄을 '미확정'(청구서 있음)과 `—`(청구서 없음·취소)로
   * 가르는 재료. 출석부가 물어본 학생(허용된 반)만 키가 있다. 판정은 순수 `attendanceNoInvoiceRows`.
   */
  invoiceStateByStudent: Record<string, AttendanceInvoiceState>;
  /**
   * 금액 이월(0278a)이 걸린 줄(`rowKey`) → 표식 재료(원장 2026-10-06) — 등록 차수 칸의 주황 틴트·마우스 오버 카드.
   * 청구액(`billed`)과 **같은 한 번의 계산**에서 나온다. 표시 전용 — 어떤 숫자도 이 값을 읽지 않는다.
   */
  carryMarks: Record<string, AttendanceCarryMark>;
  /**
   * 이 판정을 만들며 **읽지 못해 접은 재료**(한글 사유) — 화면은 종전대로 그리지만(표시), 같은 값을 **금액**에 쓰는 자리
   * (프리랜서 명세서)는 이 목록이 있으면 산정하지 않는다. 없으면 키 자체가 없다.
   */
  degraded?: string[];
};

/**
 * 청구 조회 옵션.
 *
 * `allowClassIds` — 강사 축(`loadVisibleClassAxisRows`, **활성 반만**) 밖이어도 받아들일 반 id. 지금 쓰는 곳은 하나다:
 * 출석부 강사 전체 보기의 **보이지 않는 '보강' 반**(0241a — `is_active=false`라 강사 축에 영영 안 들어온다). 회차 확정 화면은
 * 그 반의 줄도 세우고 확정·'청구서 없음'까지 판정하는데(`loadMonthRoster`), 출석부가 그 줄만 청구 판정에서 빼 두면 확정한
 * 뒤에도 '미확정'으로 남고 청구서가 없는 학생도 `—` 대신 '미확정'으로 섰다(2026-09-18).
 *
 * 🔴 **클라이언트 입력으로 채우지 말 것** — 이 함수는 서버 액션(`"use server"`)이 아니라 서버 모듈이고, 호출부(출석부 page)는
 *    `findMakeupPoolClass(user.tenantId, effectiveTeacher)`로 **스스로 푼** id 하나만 넘긴다. 쿼리 문자열·폼 값을 여기에 흘리면
 *    강사가 아무 비활성 반의 청구액을 읽는 뒷문이 된다.
 * 🔴 이중 방어 — DB에서 **이 테넌트의 보강 반**(`is_makeup_pool`)인지 다시 확인된 id만 받는다(반 이름 원문도 그 조회에서 읽는다).
 */
export type AttendanceClassBillingOptions = { allowClassIds?: readonly string[]; teacherScope?: TeacherTermScope };

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * 허용 반(보강 반)의 **원래 반 이름** — 청구 항목 매칭(`classInvoiceAmount`)이 회차 확정 화면과 같은 이름을 보게 한다
 * (출석부 묶음 제목 '보강'은 표시용 낱말이라 쓰면 안 된다).
 * ⚠️ id는 호출부가 푼 몇 개뿐(강사당 보강 반 1개)이라 `.in()` 한 번이면 된다(B3 대상 아님). admin은 RLS 우회라 `tenant_id` 필수([[#104]]).
 * ⚠️ 실패는 fail-soft — 허용 반만 판정에서 빠진다(그 줄은 종전 '미확정'). 담당 반의 청구 판정은 그대로 간다.
 */
async function loadAllowedClassNames(admin: AdminClient, tenantId: string, ids: readonly string[], degraded: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("classes")
    .select("id, class_name")
    .eq("tenant_id", tenantId)
    .eq("is_makeup_pool", true)
    .in("id", [...ids]);
  if (error) {
    console.error("[attendance-billing] 보강 반 이름 조회 실패", error.message);
    degraded.push("보강 반의 청구 정보를 읽지 못했습니다");
    return new Map();
  }
  const rows = (data ?? []) as { id: string; class_name: string | null }[];
  return new Map(rows.flatMap((r) => (r.class_name ? [[r.id, r.class_name] as const] : [])));
}

/** 강사에게는 출석부에 있는 학생×반의 청구액만 반환한다. 청구서 원문·학생 전체 금액은 서버에 둔다. */
export async function getAttendanceClassBilledAmounts(
  month: string,
  roster: readonly { classId: string; studentIds: readonly string[] }[],
  options: AttendanceClassBillingOptions = {},
): Promise<AttendanceClassBilling> {
  // 로그인 없는 출석부 조립 문맥(강사평가 밤 집계 — read-context.ts)은 서버 코드만 들어오는 길이라 권한 확인 대신 그 지점으로.
  const readCtx = attendanceReadContext();
  const user = readCtx ? { tenantId: readCtx.tenantId } : await requireAccess("attendance");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || roster.length === 0) return empty();
  const { from, to } = monthRange(month);
  const admin = createAdminClient();
  const allow = new Set(options.allowClassIds ?? []);
  const degraded: string[] = [];
  const allowedInRoster = [...new Set(roster.map((c) => c.classId).filter((id) => allow.has(id)))];
  // 두 재료는 서로 독립이라 나란히 읽는다(B4). 강사 축은 허용 목록 밖 반이 있을 때만 본다(보강 반만 묻는 호출은 건너뛴다).
  const [visible, allowed] = await Promise.all([
    roster.some((c) => !allow.has(c.classId))
      // 출석부와 동일한 권한·강사 축(요청 캐시). 표시용 번역 이름 대신 원래 반명으로 매칭한다.
      ? loadVisibleClassAxisRows(from, to).then((rows) => {
          // 담임 이력을 못 읽은 목록이면(강사 보기에서 이전 담임 반이 빠진다) 그 반의 청구가 말없이 빈다 — 표식으로 싣는다.
          const folded = foldedReason(rows);
          if (folded) degraded.push(folded);
          return new Map(rows.map((c) => [c.id, c.className]));
        })
      : Promise.resolve(new Map<string, string>()),
    loadAllowedClassNames(admin, user.tenantId, allowedInRoster, degraded),
  ]);
  const classes = roster.flatMap((c) => {
    const className = visible.get(c.classId) ?? allowed.get(c.classId);
    return className ? [{ ...c, className }] : [];
  });
  const studentIds = [...new Set(classes.flatMap((c) => c.studentIds))];
  // 허용 반(보강 반) 이름을 못 읽어 줄이 통째로 빠진 경우도 '없음'으로 접히지 않게 표식은 싣는다.
  if (studentIds.length === 0) return degraded.length > 0 ? { ...empty(), degraded } : empty();

  // invoices의 원문은 강사 RLS로 차단되어 있다. 인증·반 스코프 검증 후 테넌트/학생/월로 한정한다.
  // 🔴 **void 포함**으로 읽는다(2026-09-18) — 청구서가 "없다"와 "취소됐다"를 가르려면 취소분을 봐야 한다(`neq status void`로
  //    걸러 읽으면 둘 다 빈 결과라 못 가른다). 금액·등록 차수·「단가」는 아래에서 **취소분을 뺀** 청구서로만 센다(종전 그대로).
  const [allInvoices, weights] = await Promise.all([fetchAllPagedInChunks<AttendanceInvoice & { status: string | null }>(studentIds, (chunk, f, t) =>
    admin.from("invoices").select("id, student_id, line_items, status")
      .eq("tenant_id", user.tenantId).eq("period", month)
      .in("student_id", chunk).order("id").range(f, t),
  ), options.teacherScope
    ? loadTeacherTermWeights(admin, user.tenantId, month, classes, options.teacherScope)
    : Promise.resolve(new Map())]);
  // 등록 차수 몫의 재료(넘겨받은 JJ실 시수)를 못 읽어 접은 결과 — 상한이 넘겨받기 전 몫으로 서므로 금액 조립은 멈춘다.
  const weightsFolded = foldedReason(weights);
  if (weightsFolded) degraded.push(weightsFolded);
  const invoices = allInvoices.filter((i) => i.status !== "void");
  // 배분 유효성은 청구서 전체 반이 필요하다. 최종 결과는 classes의 학생×반으로만 좁힌다.
  // ⚠️ 회차 행은 살아 있는 청구서 것만 읽는다 — 취소된 청구서의 회차 행은 금액·차수·단가 어디에도 안 실린다.
  const termsPromise = fetchAllPagedInChunks<AttendanceBillingTerm>(invoices.map((i) => i.id), (chunk, f, t) =>
    admin.from("invoice_session_terms")
      // `unit_price`(0102a) = 확정 단가 — 「단가」 표식 연동(원장 2026-09-18). 처음부터 있던 컬럼이다.
      // `quantity_basis`(0267a)·`pricing_mode`(0266a) = 확정값의 **단위**(옛 일수 기준 표식).
      // ⚠️ 둘 다 **이미 적용된** 컬럼이다([[#95]]) — 회차 확정 화면이 프로덕션에서 같은 두 칸을 읽고 있고,
      //    2026-09-17 읽기 전용 조회로도 확인했다(확정 630행 전부 `attendance_units`).
      .select("id, invoice_id, class_id, amount, confirmed_sessions, unit_price, quantity_basis, pricing_mode, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount")
      .eq("tenant_id", user.tenantId).in("invoice_id", chunk).order("id").range(f, t),
  );
  // 금액 이월(0278a)은 회차 행과 나란히 읽는다(B4) — fail-soft(0278a 미적용·실패 = 이월 없음, 금액 열은 종전 그대로).
  const [terms, [carryOuts, carryIns]] = await Promise.all([termsPromise, Promise.all([
    loadMoneyCarryOuts(admin, month, invoices.map((i) => i.id), user.tenantId),
    loadMoneyCarryIns(admin, month, new Set(studentIds), user.tenantId),
  ])]);
  // 두 값은 **같은 조회**에서 나온다 — 청구액(배분 우선)과 등록 차수(확정 시수)가 서로 다른 재료를 보면
  // 한 줄에서 숫자가 어긋난다(원장 2026-09-17 '등록 차수' 열).
  // 출석부 금액 열은 표시라 실패해도 이월 없이 그린다(분배 저장 거절은 회차 확정·시수 검증 쪽이 한다).
  if (carryOuts.failed || carryIns.failed) degraded.push("금액 이월 내역을 읽지 못했습니다");
  const carry = { outs: new Map([...carryOuts.map].map(([id, c]) => [id, c.amount] as const)), ins: carryIns.map, outPeriod: shiftMonth(month, 1) };
  const confirmedPrices = attendanceClassConfirmedPrices(classes, invoices, terms);
  const confirmedSessions = attendanceClassConfirmedSessions(classes, invoices, terms);
  if (options.teacherScope) {
    for (const [key, share] of weights) {
      if (confirmedSessions[key]) confirmedSessions[key] = teacherTermSessions(confirmedSessions[key], options.teacherScope.teacherId, share);
    }
  }
  const detail = attendanceClassBilledDetail(classes, invoices, terms, carry);
  return {
    billed: detail.billed,
    // 이월 표식(원장 2026-10-06) — 금액과 **같은 한 번의 계산**(`detail`)에서 나온다. 미확정 줄에도 선다(금액만 적는다).
    carryMarks: attendanceCarryMarks(classes, carry, detail, confirmedPrices),
    confirmedSessions,
    confirmedPrices,
    priceConfirmed: Object.keys(confirmedPrices),
    // 상태 판정만 취소분까지 본다 — 허용된 반의 학생 전원에게 키가 선다(청구서가 없으면 `none`).
    invoiceStateByStudent: attendanceInvoiceStateByStudent(studentIds, allInvoices),
    ...(degraded.length > 0 ? { degraded } : {}),
  };
}

/** 한 학생의 상태가 두 조회에서 갈릴 때(그 사이 청구서가 생기거나 취소됨) — `attendanceInvoiceStateByStudent`와 같은 우선순위. */
const STATE_RANK: Record<AttendanceInvoiceState, number> = { none: 0, void: 1, ok: 2 };

/**
 * 따로 읽은 청구 판정 여러 벌을 **한 벌로** — 출석부 강사 전체 보기가 담당 반과 보강 반을 **따로** 조회한다
 * (보강 반은 그 명단이 정해진 뒤에야 물을 수 있어서, 담당 반 조회를 그 뒤로 미루지 않으려고 — 반응속도).
 *
 * 🔑 줄 키(`rowKey`)는 반마다 달라 겹칠 일이 없다(보강 반은 강사 축에 안 들어온다). 겹치면 **같은 청구서를 두 번 읽은
 *    같은 사실**이라 더하지 않고 덮는다(더하면 청구액이 두 배가 된다).
 * ⚠️ 학생 상태는 학생 단위라 두 벌 모두에 설 수 있다 — 같은 달 같은 청구서에서 나온 값이니 보통 같고, 갈리면 살아 있는 쪽이 이긴다.
 */
export function mergeAttendanceClassBilling(...parts: readonly AttendanceClassBilling[]): AttendanceClassBilling {
  const out = empty();
  const priced = new Set<string>();
  for (const part of parts) {
    Object.assign(out.billed, part.billed);
    Object.assign(out.confirmedSessions, part.confirmedSessions);
    Object.assign(out.confirmedPrices, part.confirmedPrices);
    Object.assign(out.carryMarks, part.carryMarks);
    if (part.degraded?.length) out.degraded = [...new Set([...(out.degraded ?? []), ...part.degraded])];
    for (const key of part.priceConfirmed) priced.add(key);
    for (const [studentId, state] of Object.entries(part.invoiceStateByStudent)) {
      const prev = out.invoiceStateByStudent[studentId];
      if (prev === undefined || STATE_RANK[state] > STATE_RANK[prev]) out.invoiceStateByStudent[studentId] = state;
    }
  }
  out.priceConfirmed = [...priced];
  return out;
}
