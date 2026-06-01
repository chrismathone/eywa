export type SystemRole =
  | "master"
  | "admin"
  | "manager"
  | "teacher"
  | "counselor"
  | "accountant"
  | "viewer";

export type MenuKey =
  | "dashboard"
  | "timetable"
  | "attendance"
  | "classes"
  | "students"
  | "enrollment"
  | "consultations"
  | "withdrawals"
  | "staff"
  | "billing"
  | "meetings"
  | "help"
  | "admin"
  | "teacher_onescreen";

export type Access = "full" | "scoped" | "readonly" | "none";

export const MENU_ACCESS: Record<MenuKey, Record<SystemRole, Access>> = {
  dashboard: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "scoped", accountant: "scoped", viewer: "readonly" },
  timetable: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly", viewer: "readonly" },
  attendance: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "readonly", viewer: "readonly" },
  classes: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "none", accountant: "none", viewer: "readonly" },
  students: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "readonly", viewer: "readonly" },
  enrollment: { master: "full", admin: "full", manager: "full", teacher: "none", counselor: "full", accountant: "none", viewer: "none" },
  consultations: { master: "full", admin: "full", manager: "full", teacher: "scoped", counselor: "full", accountant: "none", viewer: "readonly" },
  withdrawals: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "full", accountant: "full", viewer: "readonly" },
  staff: { master: "full", admin: "full", manager: "full", teacher: "readonly", counselor: "none", accountant: "full", viewer: "none" },
  billing: { master: "full", admin: "full", manager: "readonly", teacher: "none", counselor: "none", accountant: "full", viewer: "none" },
  meetings: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "readonly" },
  help: { master: "full", admin: "full", manager: "full", teacher: "full", counselor: "full", accountant: "full", viewer: "full" },
  // master 전용 — 중복 병합 / 데이터 정리 / Google Sheets 통합 등 위험도 높은 도구
  admin: { master: "full", admin: "none", manager: "none", teacher: "none", counselor: "none", accountant: "none", viewer: "none" },
  // 강사 전용 — 수업 마감 원스크린(진도·테스트·보고서). 원장(master) 사이드바엔 미표시.
  // (오버사이트가 필요하면 master를 "full"로만 바꾸면 됨.)
  teacher_onescreen: { master: "none", admin: "none", manager: "none", teacher: "full", counselor: "none", accountant: "none", viewer: "none" },
};

export function canAccess(role: SystemRole, menu: MenuKey): boolean {
  return MENU_ACCESS[menu][role] !== "none";
}

export function accessLevel(role: SystemRole, menu: MenuKey): Access {
  return MENU_ACCESS[menu][role];
}
