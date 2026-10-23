import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadContributionLessonTeachers } from "./subject-evidence";
import { contributionSubjectEvidence } from "../model/subject-evidence";
import { contributionSubjectOf } from "../model/subjects";
import type { CoreSources } from "./source-types";

it("같은 강사의 괄호 별칭을 함께 조회하고 다른 이름을 거르며 천 행 이후도 읽는다", async () => {
  const requests: URL[] = [];
  const matched = { class_name: "서술형 특강", teacher_name: "박과거(Ann)" };
  const context = [
    { class_name: "영어 A", teacher_name: "박과거" },
    { class_name: "영어 B", teacher_name: "박과거(Ann)" },
    { class_name: "수학 A", teacher_name: "박과거동명" },
  ];
  const db = createClient("https://test.supabase.co", "test-key", { auth: { persistSession: false }, global: {
    fetch: async url => {
      const request = new URL(String(url)); requests.push(request);
      const isCourse = request.searchParams.get("or")?.startsWith("(class_name.");
      const data = isCourse ? (request.searchParams.get("offset") === "0" ? Array.from({ length: 1000 }, () => matched) : [matched]) : context;
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  } });
  const core: CoreSources = { students: [], classes: [], users: [], enrollments: [], schedules: [], transitions: [], consultations: [], historyLinks: [], invoices: [] };
  const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }];
  const teachers = await loadContributionLessonTeachers(db, "campus", core, [
    { makeedu_no: "1", bill_month: "2025-01", seq: 1, item_kind: "lesson", item_name: "서술형 특강", billed: 10000, paid: 10000, refunded: false },
  ], subjects);
  expect(teachers).toEqual([matched, ...context.slice(0, 2)]);
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(request.searchParams.get("tenant_id")).toBe("eq.campus");
    expect(request.searchParams.get("order")).toBe("makeedu_no.asc,processed_at.asc,ord.asc");
    expect(request.searchParams.get("limit")).toBe("1000");
  }
  expect(requests[1]!.searchParams.get("offset")).toBe("1000");
  expect(requests[2]!.searchParams.get("or")).toContain('teacher_name.ilike."%박과거%"');
  const input = { subjects, names: [{ name: "서술형 특강", weight: 1 }], staff: [], classes: [] };
  const evidence = contributionSubjectEvidence({ ...input, teachers });
  expect(contributionSubjectOf({ ...input, evidence })({ name: "서술형 특강" })).toBe("english");
});
