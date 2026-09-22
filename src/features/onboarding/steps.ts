/**
 * 새 학원 '시작하기' 단계 — 순수 정의(서버·클라 공용). 원장 2026-09-22 방향 B + 빈 지점 점검(09-22):
 * *"대시보드나 시간표가 이 순서를 한 줄로 안내하지는 않는다"* — 가입 뒤 무엇부터 할지 알려 주는 체크리스트.
 *
 * 🔴 **새 학원(일반판)에만** 선다(`isGenericTenant`) — 침산 화면은 이 작업 전과 같아야 한다.
 * 완료 판정은 **실제 데이터가 있나**로만 한다(체크 저장 없음) — 사람이 체크를 잊어도, 지워도 거짓이 되지 않는다.
 */
export type OnboardingCounts = {
  /** 학원 설정(프로필·운영 체계)을 한 번이라도 저장했나. */
  settingsSaved: boolean;
  staff: number;
  classrooms: number;
  classes: number;
  schedules: number;
  students: number;
  enrollments: number;
  attendance: number;
  invoices: number;
};

export type OnboardingStep = { key: string; label: string; hint: string; href: string; done: boolean };

export function onboardingSteps(c: OnboardingCounts): OnboardingStep[] {
  return [
    {
      key: "settings",
      label: "학원 설정 확인",
      hint: "학원 이름·교시·과목·약관을 우리 학원에 맞게",
      href: "/owner?tab=operations",
      done: c.settingsSaved,
    },
    { key: "staff", label: "직원 등록", hint: "강사·데스크 직원 계정", href: "/staff", done: c.staff > 1 },
    { key: "classrooms", label: "강의실 등록", hint: "학원 설정 › 운영 체계 아래", href: "/owner?tab=operations", done: c.classrooms > 0 },
    { key: "classes", label: "반 만들기", hint: "반 이름·과목·담임", href: "/classes/new", done: c.classes > 0 },
    { key: "schedules", label: "시간표 배치", hint: "반마다 요일·교시", href: "/timetable", done: c.schedules > 0 },
    { key: "students", label: "원생 등록", hint: "한 명씩 또는 엑셀 가져오기", href: "/students", done: c.students > 0 },
    { key: "enrollments", label: "반에 원생 넣기", hint: "반 상세 › 학생 배정", href: "/classes", done: c.enrollments > 0 },
    { key: "attendance", label: "첫 출석 찍기", hint: "출석부", href: "/attendance", done: c.attendance > 0 },
    { key: "invoices", label: "첫 청구서", hint: "수납관리", href: "/billing", done: c.invoices > 0 },
  ];
}
