// 환불요청서 "학생 이름 고르면 자동입력" — DB 원본 → 폼 필드값 **순수 변환**(클라/서버 공용, server-only 금지 [[#61]]).
//
// ⚠️ 원칙: 추측해서 채우지 않는다. 환불요청서는 결재가 붙는 서류라, 자동으로 들어간 값은
// "확인된 사실"처럼 읽힌다. 그래서 DB에 근거가 있는 칸만 만들고(학교/학년·주소·수강반·담당·수강기간·납부내역),
// 사람이 판단하는 칸(환불사유·차감내역·총 환불금액·총수업횟수·환불방식)은 **비운 채로 둔다**.
// 총수업횟수는 계획 회차·실제 출석·청구 회차가 서로 달라 하나로 단정할 수 없어 의도적으로 제외.

import { schoolGradeLabel } from "@/lib/format/school-grade";

export type RefundPrefillEnrollment = {
  className: string;
  teacherName: string | null;
  startDate: string;
  endDate: string | null;
};

export type RefundPrefillPayment = {
  period: string; // "2026-07"
  amountPaid: number;
};

export type RefundPrefillSource = {
  name: string;
  school: string | null;
  grade: string | null;
  address: string | null;
  /** 시작일 내림차순(최근 먼저) — 서버 쿼리가 이 순서로 준다. */
  enrollments: RefundPrefillEnrollment[];
  /** 납부액이 있는 청구만, 최근 먼저. */
  payments: RefundPrefillPayment[];
};

/** 자동입력이 건드리는 폼 필드 — 화면 안내 문구·테스트가 이 목록을 단일 소스로 쓴다. */
export const REFUND_PREFILL_FIELDS = [
  "s_name",
  "s_schoolGrade",
  "s_address",
  "s_className",
  "s_staffTeacher",
  "s_homeroomTeacher",
  "s_classDate",
  "r_paymentDetails",
] as const;

/** 필드 → 서식 한글 라벨(화면 안내용) — UI에 필드명(s_className 등) 노출 금지. */
export const REFUND_PREFILL_LABELS: Record<string, string> = {
  s_name: "이름",
  s_schoolGrade: "학교/학년",
  s_address: "주소",
  s_className: "수강반",
  s_staffTeacher: "담당선생님",
  s_homeroomTeacher: "담임선생님",
  s_classDate: "수업날짜",
  r_paymentDetails: "결제내역",
};

const MAX_PAYMENT_LINES = 3;

/**
 * 자동입력할 수강 이력 — 진행 중(종료일 없음)이 있으면 그 전부, 없으면 가장 최근 1건.
 * 환불 대상은 대개 막 그만둔 학생이라 "진행 중이 없으면 빈칸"이면 정작 필요한 때 안 채워진다.
 */
function relevantEnrollments(list: RefundPrefillEnrollment[]): RefundPrefillEnrollment[] {
  const active = list.filter((e) => !e.endDate);
  return active.length > 0 ? active : list.slice(0, 1);
}

/** "2026-03-02 ~ 수강중" / "2026-03-02 ~ 2026-07-22" — 수강 시작~종료(여러 반이면 최소 시작·최대 종료). */
function classDateRange(list: RefundPrefillEnrollment[]): string {
  if (list.length === 0) return "";
  const starts = list.map((e) => e.startDate).filter(Boolean).sort();
  const start = starts[0] ?? "";
  const ongoing = list.some((e) => !e.endDate);
  const ends = list.map((e) => e.endDate ?? "").filter(Boolean).sort();
  const end = ongoing ? "수강중" : (ends[ends.length - 1] ?? "");
  if (!start) return end;
  return end ? `${start} ~ ${end}` : start;
}

/**
 * 학생 원본 → 폼 필드값. 값이 없는 칸은 **키 자체를 안 넣는다**(호출부가 "채울 게 있는 칸"만 구분).
 * 담임선생님은 담당강사가 **정확히 1명일 때만** 채운다 — eywa는 담임 개념을 폐기(과목별 담당)했고,
 * 여러 명을 나열하면 "담임이 여럿"이라는 없는 사실이 서류에 남는다.
 */
export function buildRefundPrefill(src: RefundPrefillSource): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const t = v.trim();
    if (t) out[k] = t;
  };

  put("s_name", src.name);
  put("s_schoolGrade", schoolGradeLabel(src.school, src.grade));
  put("s_address", src.address ?? "");

  const rel = relevantEnrollments(src.enrollments);
  put("s_className", rel.map((e) => e.className).filter(Boolean).join("\n"));

  const teachers = [...new Set(rel.map((e) => e.teacherName).filter((t): t is string => !!t?.trim()))];
  put("s_staffTeacher", teachers.join(" · "));
  if (teachers.length === 1) put("s_homeroomTeacher", teachers[0]!);

  put("s_classDate", classDateRange(rel));

  put(
    "r_paymentDetails",
    src.payments
      .filter((p) => p.amountPaid > 0)
      .slice(0, MAX_PAYMENT_LINES)
      .map((p) => `${p.period} ${p.amountPaid.toLocaleString("ko-KR")}원 납부`)
      .join("\n"),
  );

  return out;
}

/**
 * 자동입력 적용 대상 갈라내기 — **비어 있는 칸만** 채운다(사람이 이미 쓴 값을 덮지 않는다).
 * `current`는 폼 DOM에서 읽은 현재값. 이미 값이 있고 내용이 다른 칸은 skipped로 돌려 화면에 알린다.
 */
export function splitPrefill(
  values: Record<string, string>,
  current: Record<string, string>,
): { fill: Record<string, string>; skipped: string[] } {
  const fill: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const cur = (current[k] ?? "").trim();
    if (!cur) fill[k] = v;
    else if (cur !== v.trim()) skipped.push(k);
  }
  return { fill, skipped };
}
