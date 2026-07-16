export const EMPTY_STATE_IMAGES = {
  attendance: "/empty-states/empty-attendance-alpha.png",
  audit: "/empty-states/empty-audit-alpha.png",
  billing: "/empty-states/empty-billing-alpha.png",
  classes: "/empty-states/empty-classes-alpha.png",
  documents: "/empty-states/empty-documents-alpha.png",
  enrollment: "/empty-states/empty-enrollment-alpha.png",
  exams: "/empty-states/empty-exams-alpha.png",
  leaves: "/empty-states/empty-leaves-alpha.png",
  meetings: "/empty-states/empty-meetings-alpha.png",
  search: "/empty-states/empty-search-alpha.png",
  sends: "/empty-states/empty-sends-alpha.png",
  staff: "/empty-states/empty-staff-alpha.png",
  students: "/empty-states/empty-students-alpha.png",
  withdrawals: "/empty-states/empty-withdrawals-alpha.png",
  workspace: "/empty-states/empty-workspace-alpha.png",
} as const satisfies Record<string, `/empty-states/${string}-alpha.png`>;

export type EmptyStateImage = keyof typeof EMPTY_STATE_IMAGES;
