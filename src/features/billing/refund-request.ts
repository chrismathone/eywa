// 환불처리요청서(웹 작성 폼) — 종이 서식(환불처리요청서)을 구조화한 폼 문서.
// 작성본은 academy_documents(kind='form', form_type='refund_request', 분류 수납·결제, restricted=true)에
// 저장돼 데이터베이스 탐색기에도 나타난다. 클라/서버 공용 — server-only 금지 [[#61]].

export const REFUND_FORM_TYPE = "refund_request";

/** 환불방식 3행(종이 서식 고정) — 각 행 오른쪽 값 칸에 계좌번호·카드 정보를 적는다. */
export const REFUND_METHODS = [
  { key: "account", label: "계좌" },
  { key: "internetCard", label: "인터넷카드" },
  { key: "card", label: "카드" },
] as const;
export type RefundMethodKey = (typeof REFUND_METHODS)[number]["key"];

/** 결재란 3칸(종이 서식 상단) — 서명자 이름을 적거나 비워 두고 인쇄 후 수기 서명. */
export const APPROVAL_SLOTS = [
  { key: "staff", label: "담당" },
  { key: "viceDirector", label: "부원장" },
  { key: "director", label: "원장" },
] as const;
export type ApprovalKey = (typeof APPROVAL_SLOTS)[number]["key"];

/**
 * 로컬 초안(IndexedDB)에 **남기면 안 되는** 필드 — 계좌번호·카드정보·주소.
 * 환불요청서도 restricted 문서(사무실 전용 열람)라, 초안이 같은 값을 브라우저 디스크에 평문으로 남기면
 * 그 제한이 무의미해진다. `useFormDraft`의 exclude로 넘긴다(이력서 `RESUME_DRAFT_EXCLUDE`와 같은 규약).
 * ⚠️ 새 민감 칸을 추가하면 여기에도 넣을 것 — 초안은 name 가진 폼 컨트롤을 **전부** 캡처한다.
 */
export const REFUND_DRAFT_EXCLUDE: string[] = ["s_address", "m_account", "m_internetCard", "m_card"];

export type RefundRequestData = {
  approval: Record<ApprovalKey, string>;
  student: {
    name: string;
    schoolGrade: string; // 학교/학년
    address: string;
    reason: string; // 환불사유 (여러 줄)
    homeroomTeacher: string; // 담임선생님
    className: string; // 수강반
    staffTeacher: string; // 담당선생님
    classDate: string; // 수업날짜
    totalSessions: string; // 총수업횟수
    requestDate: string; // 환불요청일자 (YYYY-MM-DD)
  };
  refund: {
    paymentDetails: string; // 결제내역 (여러 줄)
    deductionDetails: string; // 차감내역 (여러 줄)
    totalAmount: string; // 총 환불금액
    method: Record<RefundMethodKey, string>;
  };
  result: {
    processedDate: string; // 환불처리일자 (YYYY-MM-DD)
    systemProcessed: string; // 전산처리여부
    manager: string; // 담당자 (수기 — 종이 서식 필드)
    completedDate: string; // 환불완료일자 (YYYY-MM-DD) — 이 값을 처음 입력·저장하면 아래 completedBy가 못박힌다.
    completedBy: string; // 완료 처리자 user id — 서버 전용(폼에서 안 받음, 위조 불가). 비우면(완료 해제) 함께 지워짐.
    completedByName: string; // 완료 처리자 표시명 스냅샷 — 목록·시트에 그대로 노출(조인 없이 표시).
  };
};

export function emptyRefund(): RefundRequestData {
  return {
    approval: { staff: "", viceDirector: "", director: "" },
    student: {
      name: "",
      schoolGrade: "",
      address: "",
      reason: "",
      homeroomTeacher: "",
      className: "",
      staffTeacher: "",
      classDate: "",
      totalSessions: "",
      requestDate: "",
    },
    refund: {
      paymentDetails: "",
      deductionDetails: "",
      totalAmount: "",
      method: { account: "", internetCard: "", card: "" },
    },
    result: {
      processedDate: "",
      systemProcessed: "",
      manager: "",
      completedDate: "",
      completedBy: "",
      completedByName: "",
    },
  };
}

/**
 * FormData → 구조화 데이터. 필드 name 규약: a_*(결재), s_*(학생 정보), r_*(환불내역),
 * m_*(환불방식), res_*(처리결과) — 전부 단일 name이라 초안 자동저장 round-trip 안전.
 */
export function parseRefundForm(fd: FormData): RefundRequestData {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const multi = (k: string) => String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim();
  return {
    approval: {
      staff: s("a_staff"),
      viceDirector: s("a_viceDirector"),
      director: s("a_director"),
    },
    student: {
      name: s("s_name"),
      schoolGrade: s("s_schoolGrade"),
      address: s("s_address"),
      reason: multi("s_reason"),
      homeroomTeacher: s("s_homeroomTeacher"),
      className: s("s_className"),
      staffTeacher: s("s_staffTeacher"),
      classDate: s("s_classDate"),
      totalSessions: s("s_totalSessions"),
      requestDate: s("s_requestDate"),
    },
    refund: {
      paymentDetails: multi("r_paymentDetails"),
      deductionDetails: multi("r_deductionDetails"),
      totalAmount: s("r_totalAmount"),
      method: {
        account: s("m_account"),
        internetCard: s("m_internetCard"),
        card: s("m_card"),
      },
    },
    result: {
      processedDate: s("res_processedDate"),
      systemProcessed: s("res_systemProcessed"),
      manager: s("res_manager"),
      completedDate: s("res_completedDate"),
      // completedBy/completedByName은 폼에서 안 받는다 — 서버(refund-actions)가 못박는다(위조 방지).
      completedBy: "",
      completedByName: "",
    },
  };
}

/** jsonb → 안전 정규화(누락 필드 보정) — 옛/변조 데이터에도 뷰·폼이 안 깨진다. */
export function normalizeRefund(v: unknown): RefundRequestData {
  const base = emptyRefund();
  if (!v || typeof v !== "object") return base;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const sect = (k: string) => (o[k] && typeof o[k] === "object" ? (o[k] as Record<string, unknown>) : {});
  const a = sect("approval");
  const st = sect("student");
  const r = sect("refund");
  const m = r.method && typeof r.method === "object" ? (r.method as Record<string, unknown>) : {};
  const res = sect("result");
  return {
    approval: {
      staff: str(a.staff),
      viceDirector: str(a.viceDirector),
      director: str(a.director),
    },
    student: {
      name: str(st.name),
      schoolGrade: str(st.schoolGrade),
      address: str(st.address),
      reason: str(st.reason),
      homeroomTeacher: str(st.homeroomTeacher),
      className: str(st.className),
      staffTeacher: str(st.staffTeacher),
      classDate: str(st.classDate),
      totalSessions: str(st.totalSessions),
      requestDate: str(st.requestDate),
    },
    refund: {
      paymentDetails: str(r.paymentDetails),
      deductionDetails: str(r.deductionDetails),
      totalAmount: str(r.totalAmount),
      method: {
        account: str(m.account),
        internetCard: str(m.internetCard),
        card: str(m.card),
      },
    },
    result: {
      processedDate: str(res.processedDate),
      systemProcessed: str(res.systemProcessed),
      manager: str(res.manager),
      completedDate: str(res.completedDate),
      completedBy: str(res.completedBy),
      completedByName: str(res.completedByName),
    },
  };
}

/** 저장 제목 — 데이터베이스 목록·환불 요청서 탭에 그대로 노출. */
export const refundTitle = (d: RefundRequestData) =>
  `환불 요청서 — ${d.student.name || "(이름 미입력)"}`;

/**
 * 환불요청서 필드를 (한글 라벨, 값) 목록으로 평탄화 — 고정 순서.
 * 활동 로그(activity.ts)가 old/new 두 목록을 같은 인덱스로 비교해 "라벨 old→new"로 펼친다(영문 컬럼명 미노출).
 * completedBy(내부 user id)는 제외 — 사람이 읽는 completedByName으로 대체.
 * ⚠️ RefundRequestData에 필드를 추가하면 여기에도 한글 라벨을 추가할 것(안 하면 그 필드 변경이 로그에서 누락).
 */
export function refundFieldList(d: RefundRequestData): { label: string; value: string }[] {
  return [
    { label: "결재-담당", value: d.approval.staff },
    { label: "결재-부원장", value: d.approval.viceDirector },
    { label: "결재-원장", value: d.approval.director },
    { label: "학생명", value: d.student.name },
    { label: "학교/학년", value: d.student.schoolGrade },
    { label: "주소", value: d.student.address },
    { label: "환불사유", value: d.student.reason },
    { label: "담임선생님", value: d.student.homeroomTeacher },
    { label: "수강반", value: d.student.className },
    { label: "담당선생님", value: d.student.staffTeacher },
    { label: "수업날짜", value: d.student.classDate },
    { label: "총수업횟수", value: d.student.totalSessions },
    { label: "환불요청일자", value: d.student.requestDate },
    { label: "결제내역", value: d.refund.paymentDetails },
    { label: "차감내역", value: d.refund.deductionDetails },
    { label: "총환불금액", value: d.refund.totalAmount },
    { label: "환불방식-계좌", value: d.refund.method.account },
    { label: "환불방식-인터넷카드", value: d.refund.method.internetCard },
    { label: "환불방식-카드", value: d.refund.method.card },
    { label: "환불처리일자", value: d.result.processedDate },
    { label: "전산처리여부", value: d.result.systemProcessed },
    { label: "담당자", value: d.result.manager },
    { label: "환불완료일자", value: d.result.completedDate },
    { label: "완료처리자", value: d.result.completedByName },
  ];
}
