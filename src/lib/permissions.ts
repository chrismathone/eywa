export type SystemRole =
  | "master"
  | "admin"
  | "manager"
  | "teacher"
  | "counselor"
  | "accountant"
  | "viewer"
  | "student";

export type MenuKey =
  | "dashboard"
  | "timetable"
  | "attendance"
  | "classes"
  | "students"
  | "enrollment"
  | "consultations"
  | "withdrawals"
  | "retention"
  | "staff"
  | "billing"
  | "meetings"
  | "help"
  | "admin"
  | "teacher_onescreen"
  | "my_learning"
  | "kiosk_settings";

export type Access = "full" | "scoped" | "readonly" | "none";

export const MENU_ACCESS: Record<MenuKey, Record<SystemRole, Access>> = {
  dashboard: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "scoped", accountant: "scoped", viewer: "readonly", student: "none" },
  timetable: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly", viewer: "readonly", student: "none" },
  attendance: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "readonly", viewer: "readonly", student: "none" },
  classes: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly", student: "none" },
  students: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  enrollment: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "none", student: "none" },
  consultations: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly", student: "none" },
  withdrawals: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  // 이탈 방어(리텐션) — 위험도 기반 재등록 방어. 강사는 담당 학생만(scoped), 회계는 매출 위험 열람.
  retention: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly", student: "none" },
  staff: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none", student: "none" },
  meetings: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "readonly", student: "none" },
  help: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "full", student: "none" },
  // master 전용 — 중복 병합 / 데이터 정리 / Google Sheets 통합 등 위험도 높은 도구
  admin: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // 강사 전용 — 수업 마감 원스크린(진도·테스트·보고서). 원장(master) 사이드바엔 미표시.
  // (오버사이트가 필요하면 master를 "full"로만 바꾸면 됨.)
  teacher_onescreen: { master: "none", admin: "none", manager: "none", teacher: "full", counselor: "none", accountant: "none", viewer: "none", student: "none" },
  // 학생 전용 — 내 학습 현황(누적 대시보드) + 데일리 리포트. 직원(원장·강사 등)에겐 미표시.
  my_learning: { master: "none", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "full" },
  // master 전용 — 출석 키오스크 설정(출석번호 발급·기기 등록·발송 시뮬 피드). 사이드바 미표시(직접 URL).
  kiosk_settings: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none", student: "none" },
};

export function canAccess(role: SystemRole, menu: MenuKey): boolean {
  return MENU_ACCESS[menu][role] !== "none";
}

export function accessLevel(role: SystemRole, menu: MenuKey): Access {
  return MENU_ACCESS[menu][role];
}
