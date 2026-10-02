/** 공용 설정의 권한 단위. 역할 설정 화면과 서버 게이트가 같은 목록을 쓴다. */
export const NEW_SETTINGS_ROLE_KEYS = [
  "report_settings", "ai_ment", "profile_settings", "operations_settings", "billing_settings",
  "notification_settings", "consultation_settings", "navigation_settings", "integration_settings", "popup_settings",
  "attendance_salary_settings", "payroll_settings",
] as const;
export const SETTINGS_ROLE_KEYS = [...NEW_SETTINGS_ROLE_KEYS, "kiosk_settings"] as const;
export type SettingsRoleKey = (typeof SETTINGS_ROLE_KEYS)[number];
/** 설정 권한만 위임받은 직원도 해당 화면으로 바로 들어갈 수 있는 주소. */
export const SETTINGS_ROLE_HREF: Record<SettingsRoleKey, string> = {
  report_settings: "/lesson-reports?tab=report", ai_ment: "/lesson-reports?tab=ai_ment",
  profile_settings: "/owner", operations_settings: "/owner?tab=operations", billing_settings: "/owner?tab=billing",
  notification_settings: "/owner?tab=notifications", consultation_settings: "/owner?tab=consultations",
  navigation_settings: "/owner?tab=navigation", integration_settings: "/owner?tab=sheets", popup_settings: "/owner?tab=popups",
  attendance_salary_settings: "/attendance", payroll_settings: "/billing?tab=payroll",
  kiosk_settings: "/kiosk-settings",
};

export function settingMenuForHref(href: string): SettingsRoleKey | undefined {
  const url = new URL(href, "https://local.invalid");
  if (url.pathname === "/owner") {
    const tab = url.searchParams.get("tab") ?? "profile";
    if (Object.hasOwn(OWNER_TAB_MENU, tab)) return OWNER_TAB_MENU[tab as keyof typeof OWNER_TAB_MENU];
  }
  if (url.pathname === "/lesson-reports") {
    if (url.searchParams.get("tab") === "report") return "report_settings";
    if (url.searchParams.get("tab") === "ai_ment") return "ai_ment";
  }
  if (url.pathname === "/billing" && url.searchParams.get("tab") === "payroll") return "payroll_settings";
}
export const SETTINGS_ROLE_GROUPS = {
  lesson_reports: ["report_settings", "ai_ment"],
  owner: ["profile_settings", "operations_settings", "billing_settings", "notification_settings", "consultation_settings", "navigation_settings", "integration_settings", "popup_settings"],
  timetable: ["operations_settings"],
  attendance: ["attendance_salary_settings"],
  billing: ["billing_settings", "payroll_settings"],
  integrations: ["integration_settings"],
  kiosk: ["kiosk_settings"],
} as const satisfies Record<string, readonly SettingsRoleKey[]>;
export type SettingsRoleGroup = keyof typeof SETTINGS_ROLE_GROUPS;
export const OWNER_SECTION_MENU = {
  profile: "profile_settings", operations: "operations_settings", billing: "billing_settings",
  notifications: "notification_settings", consultations: "consultation_settings", navigation: "navigation_settings",
  report: "report_settings",
} as const;
export const OWNER_TAB_MENU = {
  ...OWNER_SECTION_MENU, subjects: "operations_settings", sheets: "integration_settings", popups: "popup_settings",
} as const;
