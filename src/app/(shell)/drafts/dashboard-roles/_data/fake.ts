/**
 * 역할별 운영실 **시안 전용 가짜 데이터** — DB를 읽지 않는다.
 *
 * 🔴 이름은 전부 가명, 금액·인원·날짜는 지어낸 값이다. 실제 원생·직원·금액을 옮겨 적지 말 것.
 * 과목 키는 여기서 정하지 않는다 — 화면이 학원설정(`useSubjectMaps().options`)에서 받은 키를
 * `subjectFake(key)`에 넘기면 키에서 숫자를 굴려 만든다(어느 과목이든 같은 모양이 나온다).
 */

export const FAKE_DAY = "10월 1일 수요일";

export const STUDENTS = [
  "김가온", "이나래", "박다솜", "최라온", "정마루", "강바다",
  "윤새봄", "장아라", "임자람", "한하람", "오누리", "서다온",
] as const;

export const STAFF = ["한결", "도담", "가람", "누리", "해솔", "보람", "이든", "로운"] as const;

export const SCHOOLS = ["가람중", "나래중", "다솜고", "라온고", "마루초"] as const;

const CLASS_NAMES = ["월수 A반", "월수 B반", "화목 A반", "화목 심화", "금토 기초", "주말 특강"] as const;
const ROOMS = ["201호", "202호", "301호", "302호", "랩실", "403호"] as const;
const SLOTS = ["15:00", "16:20", "17:30", "18:40", "19:50", "21:00"] as const;

/** 과목 키 → 0~996 고정 수(같은 키면 늘 같은 숫자). */
export function seedOf(key: string): number {
  let h = 7;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h;
}

function at<T>(arr: readonly T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length]!;
}

/** 학원 전체(원장 시안) — 지어낸 값. 금액 단위는 만원. */
export const ACADEMY = {
  kpi: [
    { label: "재원생", value: 312, unit: "명", sub: "지난달 말보다 +4" },
    { label: "퇴원생", value: 6, unit: "명", sub: "10월 1일~오늘" },
    { label: "신규문의", value: 14, unit: "건", sub: "이번 달" },
    { label: "금일입테", value: 3, unit: "명", sub: "오늘 예정" },
    { label: "금일 등록", value: 2, unit: "명", sub: "오늘 확정" },
    { label: "오늘첫수업", value: 4, unit: "명", sub: "신입 첫 수업" },
    { label: "결석학생", value: 9, unit: "명", sub: "어제 기준" },
    { label: "보강예정", value: 12, unit: "건", sub: "오늘부터 한 달" },
  ],
  money: { billed: 9870, paid: 8420, unpaid: 1450, unpaidCount: 14, payout: 3210, expense: 1180 },
  months: ["26.05", "26.06", "26.07", "26.08", "26.09", "26.10"],
  billedTrend: [8920, 9150, 9480, 9610, 9790, 9870],
  joinTrend: [11, 9, 14, 8, 12, 2],
  leaveTrend: [5, 7, 4, 6, 8, 6],
  withdrawReasons: [
    { label: "성적·진도 불만", n: 3, detail: "상담 기록: 중간고사 뒤 학부모 요청" },
    { label: "다른 학원으로", n: 2, detail: "가까운 학원·형제 따라" },
    { label: "이사", n: 1, detail: "11월 전학 예정" },
  ],
} as const;

/** 과목 단위 시안 숫자 — 키에서 굴린 값(가짜). */
export function subjectFake(key: string) {
  const s = seedOf(key);
  const classes = CLASS_NAMES.map((name, i) => ({
    name,
    teacher: at(STAFF, s + i),
    students: 6 + ((s + i * 5) % 9),
    attendRate: 84 + ((s + i * 3) % 15),
    room: at(ROOMS, s + i * 2),
    time: at(SLOTS, i),
    reportsDone: (s + i) % 4 === 0 ? 3 : 6 + ((s + i) % 3),
    reportsDue: 6 + ((s + i) % 3) + ((s + i) % 4 === 0 ? 2 : 0),
  }));
  return {
    enrolled: 110 + (s % 90),
    joined: 4 + (s % 6),
    left: 1 + (s % 4),
    absentToday: 2 + (s % 5),
    makeups: 3 + (s % 7),
    reportRate: 78 + (s % 19),
    classes,
    absences: STUDENTS.slice(0, 5).map((name, i) => ({
      name,
      school: `${at(SCHOOLS, s + i)}${1 + ((s + i) % 3)}`,
      className: at(CLASS_NAMES, s + i),
      streak: 1 + ((s + i * 2) % 3),
      makeup: i % 2 === 0 ? "보강 예약됨" : "보강 미정",
    })),
    watch: STUDENTS.slice(4, 9).map((name, i) => ({
      name,
      school: `${at(SCHOOLS, s + i + 2)}${1 + ((s + i) % 3)}`,
      reason: at(["결석 3회 연속", "과제 2주 미제출", "테스트 20점 하락", "보강 두 번 미이행", "지각 잦음"], s + i),
      tone: (i < 2 ? "critical" : "caution") as "critical" | "caution",
    })),
    teachers: STAFF.slice(0, 5).map((name, i) => ({
      name,
      classes: 2 + ((s + i) % 4),
      reportRate: 70 + ((s + i * 7) % 30),
      makeups: (s + i) % 4,
    })),
  };
}

export type SubjectFake = ReturnType<typeof subjectFake>;

/** 데스크(접수) 시안 — 오늘 일정·연락할 곳·미납 건(가짜). 금액 단위 원. */
export const DESK = {
  timeline: [
    { time: "14:00", kind: "상담", who: "이나래 학부모", note: "방문 상담 · 중2" },
    { time: "15:30", kind: "입테", who: "박다솜", note: "레벨테스트 · 고1" },
    { time: "16:00", kind: "등록", who: "최라온", note: "서류·수강 확정" },
    { time: "17:10", kind: "입테", who: "정마루", note: "레벨테스트 · 중3" },
    { time: "19:00", kind: "상담", who: "강바다 학부모", note: "전화 상담 예약" },
  ],
  calls: [
    { who: "윤새봄", why: "어제 무단 결석", tone: "critical" as const },
    { who: "장아라", why: "10월 수강료 미납 안내", tone: "caution" as const },
    { who: "임자람 학부모", why: "상담 콜백 요청", tone: "info" as const },
    { who: "한하람", why: "보강 시간 확인", tone: "special" as const },
  ],
  unpaid: STUDENTS.slice(6, 12).map((name, i) => ({
    name,
    item: i % 2 === 0 ? "10월 수강료" : "교재비",
    amount: i % 2 === 0 ? 380000 + i * 10000 : 24000,
    days: 3 + i * 2,
  })),
  changes: [
    { name: "오누리", kind: "신규 등록", when: "오늘", tone: "positive" as const },
    { name: "서다온", kind: "반 이동", when: "10/6부터", tone: "special" as const },
    { name: "김가온", kind: "퇴원 예약", when: "10/31", tone: "inert" as const },
    { name: "이나래", kind: "휴원", when: "10/1~10/14", tone: "caution" as const },
  ],
} as const;

/** 원 단위 숫자를 "380,000원"으로. */
export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 만원 단위 숫자를 "9,870만"으로. */
export function manwon(n: number): string {
  return `${n.toLocaleString("ko-KR")}만`;
}
