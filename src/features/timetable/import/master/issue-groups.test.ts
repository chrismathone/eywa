import { expect, it } from "vitest";
import { acknowledgeIssues, groupMasterIssues } from "./issue-groups";
import type { MasterIssue } from "./types";
const issue = (
  key: string,
  severity: MasterIssue["severity"] = "confirm",
): MasterIssue => ({ key, severity, target: key, reason: "이유", fix: "수정" });
it("학생 동일성·퇴원·수업 충돌을 구별하며 알 수 없는 항목도 빠뜨리지 않는다", () => {
  const groups = groupMasterIssues([
    issue("student-time:1"),
    issue("status:1", "error"),
    issue("match:1"),
    issue("new-kind:1"),
  ]);
  expect(groups.map((g) => g.label)).toEqual([
    "학생 연결·동명이인",
    "재원·휴원 상태",
    "수업 충돌·시간",
    "기타",
  ]);
  expect(groups.flatMap((g) => g.issues)).toHaveLength(4);
});
it("전체 확인은 확인 항목만 추가하고 분류 해제는 다른 분류의 확인을 보존한다", () => {
  const items = [
    issue("match:1"),
    issue("conflict:1"),
    issue("status:1", "error"),
    issue("memo:1", "warning"),
  ];
  expect(acknowledgeIssues(items, ["match:1"], true)).toEqual([
    "match:1",
    "conflict:1",
  ]);
  expect(
    acknowledgeIssues([items[0]!], ["match:1", "conflict:1"], false),
  ).toEqual(["conflict:1"]);
});
