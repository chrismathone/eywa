import { ready, type CareRaw } from "./types";

/** Synthetic records only. Used by the preview and regression tests. */
export function careFixture(): CareRaw {
  return {
    studentId: "10000000-0000-4000-8000-000000000001", today: "2026-10-20", enrolledAt: "2026-01-01", canWriteConsultation: true,
    subjectLabels: { math: "수학", english: "영어" },
    enrollments: ready([{ id: "e1", start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false }]),
    reports: ready([
      ...[1, 2, 3, 4].map((n) => ({ id: `old-${n}`, report_date: `2026-09-0${n}`, subject: "math", homework_score: "90%" })),
      ...[1, 2, 3, 4].map((n) => ({ id: `new-${n}`, report_date: `2026-10-0${n}`, subject: "math", homework_score: "60%" })),
    ]),
    attendance: ready([1, 2, 3, 4].map((n) => ({ id: `a${n}`, student_id: "s", class_id: "c", slot_start: "16:00",
      session_date: `2026-10-0${n}`, recorded_at: `2026-10-0${n}T08:00:00Z`, status: n < 3 ? "absent" : "present" }))),
    grades: ready([
      { id: "g1", subject: "math", exam_name: "단원 확인", taken_on: "2026-01-10", score: 65, max_score: 100 },
      { id: "g2", subject: "math", exam_name: "단원 확인", taken_on: "2026-10-10", score: 78, max_score: 100 },
    ]),
    levels: ready([{ id: "l1", subject: "math", test_type: "diagnostic", tested_on: "2026-10-10", level: "기본 개념 학습" }]),
    consultations: ready([{ id: "20000000-0000-4000-8000-000000000001", consulted_at: "2026-10-12T01:00:00Z",
      audience: "parent", summary: "가상 상담: 숙제 분량과 풀이 시간을 함께 확인하기로 했습니다.",
      follow_up_date: "2026-10-22", follow_up_done: false, follow_up_action: "학습량 조정 후 수행률 확인" }]),
    invoices: ready([{ id: "i1", period: "2026-10", status: "paid", amount_paid: 300000,
      line_items: [{ kind: "수업", description: "가상 수학반", paid: 300000, amount: 300000, refunds: [] }] }]),
  };
}
