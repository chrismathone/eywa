import { describe, expect, it } from "vitest";
import alert from "./seat-limit-alert.cjs";
import remoteDb from "../_sync-agent/remote-db.cjs";
import { compileAgentQuery } from "../../src/features/sync-agent/query-compiler";
import catalog from "../../src/features/sync-agent/server/query-catalog.json";

function fixture({ limit = 10, enrolled = 11, recipients = 1 } = {}) {
  const calls = [];
  const sql = remoteDb("", {}, async (action, body) => {
    expect(action).toBe("query");
    const wire = JSON.parse(JSON.stringify(body));
    const query = compileAgentQuery(catalog, "makeedu", wire);
    expect(() => compileAgentQuery(catalog, "classnote", wire)).toThrow();
    calls.push(query);
    const rows = query.text.includes("from tenant_licenses") ? (limit === null ? [] : [{ max_seats: limit }])
      : query.text.includes("count(*)::int as enrolled") ? [{ enrolled }]
      : Array.from({ length: recipients }, (_, id) => ({ id }));
    return { rows, count: rows.length, columns: [] };
  });
  return { sql, calls };
}

describe("makeedu 좌석 초과 원장 알림 — 실제 원격 질의 경로", () => {
  it("추가 재원생이 없으면 조회하지 않는다", async () => {
    const f = fixture();
    expect(await alert.notifySeatLimitExceeded(f.sql, "tenant", 0)).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  it("제한 없음·미초과이면 알림을 만들지 않는다", async () => {
    for (const input of [{ limit: null }, { enrolled: 10 }]) {
      const f = fixture(input);
      expect(await alert.notifySeatLimitExceeded(f.sql, "tenant", 1)).toBe(0);
      expect(f.calls.some((q) => q.text.includes("insert into"))).toBe(false);
    }
  });
  it("원장 알림과 중복 방지를 한 문장으로 기록하고 지점 값을 바인딩한다", async () => {
    const f = fixture({ recipients: 2 });
    expect(await alert.notifySeatLimitExceeded(f.sql, "tenant", 1)).toBe(2);
    const q = f.calls[2];
    expect(q.text).toContain("where exists (select 1 from recipients)");
    expect(q.text).toContain("on conflict (tenant_id, event_type, subject_key, bucket) do nothing");
    expect(q.text).toContain("from recipients cross join fresh");
    expect(q.values).toContain("tenant");
    expect(q.values).toContain("10:11");
    expect(q.values).toContain("makeedu 학생 가져오기 후 재원생 11명 · 좌석 한도 10석");
  });
  it("중복 초과이거나 받을 원장이 없으면 새 알림이 없다", async () => {
    const f = fixture({ recipients: 0 });
    expect(await alert.notifySeatLimitExceeded(f.sql, "tenant", 1)).toBe(0);
  });
});
