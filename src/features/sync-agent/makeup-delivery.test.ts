import { describe, expect, it } from "vitest";
import { compileAgentQuery, type QueryCatalog } from "./query-compiler";
import catalog from "./server/query-catalog.json";
import remoteDb from "../../../scripts/_sync-agent/remote-db.cjs";
import { isMakeupDeliveryEligible } from "../../../scripts/_classnote/classnote-class-route.mjs";

describe("보강 전달 경로 — AywaSync 원격 DB 경로", () => {
  it("실제 워커 SQL을 허용 질의 ID로 전송하고 서버에서 컴파일한다", async () => {
    const queries: { text: string; values: unknown[] }[] = [];
    const sql = remoteDb("", {}, async (action: string, body: Parameters<typeof compileAgentQuery>[2]) => {
      expect(action).toBe("query");
      const wire = JSON.parse(JSON.stringify(body));
      const compiled = compileAgentQuery(catalog as QueryCatalog, "classnote", wire);
      expect(() => compileAgentQuery(catalog as QueryCatalog, "makeedu", wire)).toThrow();
      queries.push(compiled);
      return { rows: [{ ok: 1 }], columns: [], count: 1 };
    });
    expect(await isMakeupDeliveryEligible(sql, "tenant", {
      class_id: null, makeup_class_id: "JJ", classnote_class_id: "MS", student_id: "student", subject: "math", report_date: "2026-11-12",
    })).toBe(true);
    expect(queries).toHaveLength(2);
    expect(queries[1].text).toContain("enrollments e");
    expect(queries[1].values).toContain("tenant");
    expect(queries[1].values).toContain("student");
    expect(queries[1].values).toContain("2026-11-12");
  });
});
