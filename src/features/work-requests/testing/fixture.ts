/** 개발 화면·시험 전용 업무 요청. 모든 값은 가상이다. 보는 사람 = u0(원장). */
import type { WorkBoard, WorkItem, WorkPerson, WorkStep } from "../model";

const p = (id: string, name: string, role: string, subjects: string[] = []): WorkPerson => ({ id, name, role, subjects });
const ME = p("u0", "원장 가", "원장");
const KIM = p("u1", "관리자 나", "관리자");
const LEE = p("u2", "매니저 다", "매니저");
const T1 = p("t0", "강사 가", "강사", ["수학"]);
const T2 = p("t1", "강사 나", "강사", ["영어"]);
const step = (user: WorkPerson, state: WorkStep["state"], extra: Partial<WorkStep> = {}): WorkStep => ({ user, state, ackedAt: state === "ready" ? null : "2026-11-02T01:10:00Z", reportedAt: state === "reported" ? "2026-11-02T05:20:00Z" : null, outcome: state === "reported" ? "done" : null, note: null, returnedNote: null, ...extra, returned: extra.returned ?? !!extra.returnedNote });
const base = { body: "", criteria: "", source: null, reviewer: null, reviewNote: null, closedAt: null, closedBy: null, links: [], events: [] } satisfies Partial<WorkItem>;

export const FIXTURE_WORK: WorkBoard = {
  enabled: true, me: "u0", canCreate: true, canMonitor: true,
  staff: [ME, KIM, LEE, T1, T2],
  items: [
    {
      ...base, id: "w1", category: "general", title: "10월 미납 5건 대조 및 학부모 안내", requester: ME, dueOn: "2026-11-04", status: "working", createdAt: "2026-11-02T00:10:00Z",
      body: "입금 내역과 대조하고 남은 금액이 맞으면 보호자 안내 여부를 확인해 주세요.", criteria: "5건 모두 입금 확인 또는 보호자 안내 기록",
      steps: [step(KIM, "reported", { note: "3건 입금 확인 · 2건 보호자 문자 안내" }), step(LEE, "acked")],
      events: [{ at: "2026-11-02T00:10:00Z", actor: "원장 가", actorId: "u0", kind: "created", note: "담당 2명" }, { at: "2026-11-02T01:10:00Z", actor: "관리자 나", actorId: "u1", kind: "acked", note: null }, { at: "2026-11-02T05:20:00Z", actor: "관리자 나", actorId: "u1", kind: "reported", note: "3건 입금 확인 · 2건 보호자 문자 안내" }],
    },
    {
      ...base, id: "w2", category: "general", title: "반복 결석 학생 확인 (14일 · 사전 통보 제외 3회 이상)", requester: ME, dueOn: "2026-11-05", status: "review", createdAt: "2026-11-01T23:00:00Z", source: "check:absence",
      // 서식 글(담당자별 · 그 반 날짜만) — 상세 창의 서식 · 접기를 개발 화면에서 본다.
      body: "<p>사전 통보 없이 3회 이상 결석한 학생입니다. 맡은 학생의 결석 사유와 보강 계획을 확인해 주세요.</p>"
        + "<h3>강사 가 선생님 · 3명</h3><ul><li><strong>학생 아</strong> A중3 — 결석 4회 · 중2 수학 A 10/22 · 10/27 · 10/29 · 10/30</li>"
        + "<li><strong>학생 자</strong> A중2 — 결석 3회 · 중2 수학 A 10/21 · 10/23 · 10/28</li><li><strong>학생 카</strong> B중1 — 결석 3회 · 중1 수학 B 10/22 · 10/24 · 10/29</li></ul>"
        + "<h3>강사 나 선생님 · 2명</h3><ul><li><strong>학생 사</strong> A중2 — 결석 1회 · 초5 영어 10/30</li><li><strong>학생 타</strong> B초6<ul><li>결석 2회 · 초6 영어 10/23 · 10/30</li><li>보호자 통화 메모: 다음 주부터 화요일만 옵니다</li></ul></li></ul>"
        + "<h3>담당 미정 · 1명</h3><ul><li><strong>학생 차</strong> B초5 — 결석 3회 · 반 모름 10/21 · 10/24 · 10/28</li></ul>",
      criteria: "학생마다 결석 사유 · 보호자 연락 여부 · 보강 계획을 보고에 적는다",
      steps: [step(T1, "reported", { note: "학생 아: 가족 여행 · 보강 11/6 예약" }), step(T2, "reported", { note: "학생 사: 학교 시험 · 보호자 통화함" })],
      links: [{ type: "student", id: "s6", label: "학생 아", assigneeId: "t0" }, { type: "student", id: "s5", label: "학생 사", assigneeId: "t1" }, { type: "student", id: "s9", label: "학생 차", assigneeId: null }],
      events: [{ at: "2026-11-01T23:00:00Z", actor: "원장 가", actorId: "u0", kind: "created", note: "담당 2명 · 학생 2명" },
        { at: "2026-11-02T05:00:00Z", actor: "강사 가", actorId: "t0", kind: "reported", note: "학생 아: 가족 여행 · 보강 11/6 예약" },
        { at: "2026-11-02T06:00:00Z", actor: "강사 나", actorId: "t1", kind: "reported", note: "학생 사: 학교 시험 · 보호자 통화함" },
        { at: "2026-11-02T06:00:00Z", actor: null, actorId: null, kind: "to_review", note: null }],
    },
    {
      ...base, id: "w3", category: "weekly", title: "11월 1주 주간보고", requester: KIM, dueOn: "2026-11-03", status: "working", createdAt: "2026-11-02T00:00:00Z",
      steps: [step(ME, "ready")], events: [{ at: "2026-11-02T00:00:00Z", actor: "관리자 나", actorId: "u1", kind: "created", note: "담당 1명" }],
    },
    {
      ...base, id: "w4", category: "handover", title: "중2 심화A 인수인계", requester: ME, reviewer: KIM, dueOn: "2026-10-31", status: "closed", createdAt: "2026-10-28T00:00:00Z",
      closedAt: "2026-10-31T08:00:00Z", closedBy: "관리자 나", reviewNote: "자료 확인함",
      steps: [step(T1, "reported", { outcome: "done", note: "진도표 · 학생별 메모 넘김" })],
      events: [{ at: "2026-10-28T00:00:00Z", actor: "원장 가", actorId: "u0", kind: "created", note: "담당 1명" }, { at: "2026-10-31T08:00:00Z", actor: "관리자 나", actorId: "u1", kind: "approved", note: "자료 확인함" }],
    },
  ],
};
