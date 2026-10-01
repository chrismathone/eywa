import type { MasterIssue } from "./types";

const categories = [
  {
    id: "student",
    label: "학생 연결·동명이인",
    prefixes: ["student", "match"],
  },
  { id: "status", label: "재원·휴원 상태", prefixes: ["status"] },
  {
    id: "class",
    label: "반 연결·진급",
    prefixes: [
      "class",
      "identity",
      "mapping",
      "name",
      "held",
      "rename-cycle",
      "close",
      "vanished",
    ],
  },
  {
    id: "teacher",
    label: "강사·강의실",
    prefixes: ["teacher", "teacher-binding", "room", "multi-teacher"],
  },
  {
    id: "time",
    label: "수업 충돌·시간",
    prefixes: ["conflict", "student-time", "ambiguous-slot", "time"],
  },
  {
    id: "enrollment",
    label: "수강·출결",
    prefixes: [
      "retained",
      "move",
      "period",
      "attendance",
      "student-attendance",
    ],
  },
  {
    id: "reservation",
    label: "기존 예약",
    prefixes: ["pending", "later", "later-block"],
  },
  {
    id: "sheet",
    label: "시트·명단 형식",
    prefixes: ["empty", "count", "parse", "memo", "groups"],
  },
  { id: "other", label: "기타", prefixes: [] },
];

export function groupMasterIssues(issues: MasterIssue[]) {
  const groups = categories.map((c) => ({
    id: c.id,
    label: c.label,
    issues: [] as MasterIssue[],
  }));
  for (const issue of issues) {
    const prefix = issue.key.split(":")[0]!;
    const index = categories.findIndex((c) => c.prefixes.includes(prefix));
    groups[index < 0 ? groups.length - 1 : index]!.issues.push(issue);
  }
  return groups.filter((g) => g.issues.length);
}

/** Bulk acknowledgement never includes errors or warnings, and never triggers apply. */
export function acknowledgeIssues(
  issues: MasterIssue[],
  checked: string[],
  selected: boolean,
) {
  const keys = new Set(
    issues.filter((i) => i.severity === "confirm").map((i) => i.key),
  );
  return selected
    ? [...new Set([...checked, ...keys])]
    : checked.filter((key) => !keys.has(key));
}
