export type ReportConsultation = {
  id: string; consultedAt: string; audience: "parent" | "student" | "both" | null; summary: string;
};
