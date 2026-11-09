import type { WorkRecord } from "./model";

/**
 * 업무 작성센터 시안의 예시 값 — 🔴 DB를 읽지 않는다(academy_work_records 표가 이 DB에 없다).
 * 이름은 지어낸 값이다. '나'(작성자)는 김하늘, 검토자 화면으로 그린다.
 */
export type WorkRecordsData = {
  rows: WorkRecord[];
  actorId: string;
  canReview: boolean;
  today: string;
  access: { key: string; read: boolean; write: boolean }[];
};

const ME = "staff-kimhaneul", LEE = "staff-leedoyun", PARK = "staff-parkseojun";
const row = (id: string, author: string, version: number, updated: string, document: WorkRecord["document"]): WorkRecord => ({ id, author_id: author, version, updated_at: updated, document });

/** 시안에서 바로 갈 수 있는 화면(main에 있는 라우트)만 연다. */
const READABLE = ["documents", "ecs", "mcs", "teacher_onescreen", "lesson_reports", "consultations", "enrollment", "newcomers", "students", "meetings", "approvals"];

export function sampleWorkRecords(today: string): WorkRecordsData {
  return {
    actorId: ME,
    canReview: true,
    today,
    access: READABLE.map(key => ({ key, read: true, write: true })),
    rows: [
      row("wr-0001", ME, 3, "2026-11-07T08:40:00.000Z", { template: "weekly", title: "11월 1주 중등 수학 주간 업무보고", date: "2026-11-07", plan: "중2 기말 대비 단원평가 2회, 결석생 보강 3명", action: "단원평가 2회 실시, 보강 2명 완료", result: "평균 78점(전주 대비 +4). 1명은 일정 미정으로 보강 미완료", next: "남은 보강 일정 확정, 오답 유형 정리본 배포", state: "submitted", reviewNote: "" }),
      row("wr-0002", ME, 1, "2026-11-05T05:12:00.000Z", { template: "improvement", title: "하원 셔틀 대기 동선 개선 제안", date: "2026-11-05", plan: "하원 시간 1층 로비 혼잡 완화", action: "반별 하원 시간을 5분 간격으로 나누는 안", result: "11월 첫 주 관찰: 21:50 전후 40여 명 동시 대기", next: "", state: "draft", reviewNote: "" }),
      row("wr-0003", ME, 2, "2026-10-31T10:05:00.000Z", { template: "training", title: "서술형 채점 기준 연수 기록", date: "2026-10-31", plan: "서술형 부분점수 기준 통일", action: "교육청 예시 문항 6개 채점 실습", result: "강사 간 채점 차이 평균 1.2점 → 0.4점", next: "11월 월말평가부터 같은 기준 적용", state: "reviewed", reviewNote: "좋습니다. 기준표를 공용 자료함에도 올려 주세요." }),
      row("wr-0004", LEE, 1, "2026-11-08T02:30:00.000Z", { template: "handover", title: "고1 영어 B반 인수인계서", date: "2026-11-08", plan: "11월 3주부터 담당 변경", action: "진도: 교재 6과 중반, 단어시험 매주 화요일", result: "과제 미제출 2명 상담 진행 중", next: "11/15까지 학부모 안내 문자 발송", state: "submitted", reviewNote: "" }),
      row("wr-0005", PARK, 2, "2026-11-06T09:00:00.000Z", { template: "proposal", title: "겨울방학 예비 고1 특강 기획안", date: "2026-11-06", plan: "예비 고1 수학 선행 8주 과정", action: "주 3회, 반 정원 12명, 담당 박서준", result: "작년 같은 특강 등록 21명 · 재원 전환 15명", next: "11월 말 설명회 일정 확정", state: "submitted", reviewNote: "" }),
    ],
  };
}
