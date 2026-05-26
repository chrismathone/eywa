export type SystemRole =
  | "master"
  | "admin"
  | "teacher"
  | "counselor"
  | "accountant";

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
  | "help";

export type Access = "full" | "scoped" | "readonly" | "none";

export const MENU_ACCESS: Record<MenuKey, Record<SystemRole, Access>> = {
  dashboard: { master: "full", admin: "full", teacher: "scoped", counselor: "scoped", accountant: "scoped" },
  timetable: { master: "full", admin: "full", teacher: "scoped", counselor: "readonly", accountant: "readonly" },
  attendance: { master: "full", admin: "full", teacher: "scoped", counselor: "none", accountant: "readonly" },
  classes: { master: "full", admin: "full", teacher: "scoped", counselor: "none", accountant: "none" },
  students: { master: "full", admin: "full", teacher: "scoped", counselor: "full", accountant: "readonly" },
  enrollment: { master: "full", admin: "full", teacher: "none", counselor: "full", accountant: "none" },
  consultations: { master: "full", admin: "full", teacher: "scoped", counselor: "full", accountant: "none" },
  withdrawals: { master: "full", admin: "full", teacher: "readonly", counselor: "full", accountant: "full" },
  staff: { master: "full", admin: "full", teacher: "readonly", counselor: "none", accountant: "full" },
  billing: { master: "full", admin: "full", teacher: "none", counselor: "none", accountant: "full" },
  meetings: { master: "full", admin: "full", teacher: "full", counselor: "full", accountant: "full" },
  help: { master: "full", admin: "full", teacher: "full", counselor: "full", accountant: "full" },
};

export function canAccess(role: SystemRole, menu: MenuKey): boolean {
  return MENU_ACCESS[menu][role] !== "none";
}

export function accessLevel(role: SystemRole, menu: MenuKey): Access {
  return MENU_ACCESS[menu][role];
}
