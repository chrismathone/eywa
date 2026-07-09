/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- in-memory supabase 가짜(체이너블 빌더)는 any가 불가피, 일부 인자 미사용 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestReport } from "./ingest";
import { positionOf } from "../curriculum-position";

// ── 최소 in-memory supabase 가짜(ingest가 쓰는 체인만) — 컨테이너 생명주기를 실제 DB처럼 시뮬레이트 ──
type Store = { students: Record<string, { grade: string }>; progress_containers: any[]; progress_entries: any[]; progress_events: any[] };

function makeFake(students: Record<string, { grade: string }>) {
  let seq = 0;
  const db: Store = { students: { ...students }, progress_containers: [], progress_entries: [], progress_events: [] };
  const rowsFor = (table: string, filters: [string, unknown][]) => {
    if (table === "students") {
      return filters.every((f) => f[0] === "id") ? [db.students[filters[0]![1] as string]].filter(Boolean).map((g) => ({ grade: g!.grade })) : [];
    }
    let r = (db as any)[table] as any[];
    for (const [col, val] of filters) r = r.filter((x) => x[col] === val);
    return r;
  };
  function builder(table: string) {
    const st: any = { table, op: null as string | null, payload: null, returning: false, filters: [] as [string, unknown][], order: null as any, limitN: null as number | null };
    const exec = (mode: "maybeSingle" | "single" | "await") => {
      if (st.op === "insert") {
        const items = Array.isArray(st.payload) ? st.payload : [st.payload];
        const ins = items.map((it: any) => ({ id: `id${++seq}`, ...it }));
        (db as any)[table].push(...ins);
        return mode === "await" ? { data: null, error: null } : { data: ins[0], error: null };
      }
      if (st.op === "update") {
        for (const x of rowsFor(table, st.filters)) Object.assign(x, st.payload);
        return { data: null, error: null };
      }
      let r = rowsFor(table, st.filters);
      if (st.order) r = [...r].sort((a, b) => ((a[st.order.col] ?? 0) - (b[st.order.col] ?? 0)) * (st.order.asc ? 1 : -1));
      if (st.limitN != null) r = r.slice(0, st.limitN);
      if (mode === "maybeSingle") return { data: r[0] ?? null, error: null };
      if (mode === "single") return { data: r[0] ?? null, error: r[0] ? null : { message: "no rows" } };
      return { data: r, error: null };
    };
    const b: any = {
      select(_cols: string) {
        if (st.op === "insert") st.returning = true;
        else st.op = "select";
        return b;
      },
      eq(col: string, val: unknown) { st.filters.push([col, val]); return b; },
      order(col: string, opts?: { ascending?: boolean }) { st.order = { col, asc: opts?.ascending ?? true }; return b; },
      limit(n: number) { st.limitN = n; return b; },
      insert(payload: unknown) { st.op = "insert"; st.payload = payload; return b; },
      upsert(payload: unknown, _opts?: unknown) { st.op = "insert"; st.payload = payload; return b; }, // 가짜는 unique 미강제 → insert처럼
      update(payload: unknown) { st.op = "update"; st.payload = payload; return b; },
      maybeSingle: () => Promise.resolve(exec("maybeSingle")),
      single: () => Promise.resolve(exec("single")),
      then: (res: any, rej: any) => Promise.resolve(exec("await")).then(res, rej),
    };
    return b;
  }
  return { client: { from: (t: string) => builder(t) } as unknown as SupabaseClient, db };
}

const T = "t1";
let rid = 0;
const report = (studentId: string, progress: string, subject: string | null = "math") => ({
  id: `r${++rid}`,
  tenantId: T,
  studentId: studentId,
  reportDate: "2026-07-09",
  subject,
  progress,
});

// 커리큘럼 실제 차시(위치 관계 활용)
const L_초3_1 = "수학 1-1-1 받아올림이 없는, 한 번 있는 (세 자리 수)+(세 자리 수)";
const L_중2_절편 = "수학 일차함수의 그래프와 절편";
const L_중2_기울기 = "수학 일차함수의 그래프와 기울기";
const L_중1_소인수 = "수학 소인수분해";

describe("ingestReport — skip 규칙", () => {
  it("비수학 subject → not-math, 무기록", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    const res = await ingestReport(client, report("s1", "영어 Unit 8", "english"));
    expect(res.skipped).toBe("not-math");
    expect(db.progress_containers).toHaveLength(0);
  });
  it("커리큘럼 미매칭 진도 → no-position", async () => {
    const { client } = makeFake({ s1: { grade: "중2" } });
    expect((await ingestReport(client, report("s1", "수학 존재안함xyz"))).skipped).toBe("no-position");
  });
  it("학년 파싱 불가 → no-track", async () => {
    const { client } = makeFake({ s1: { grade: "" } });
    expect((await ingestReport(client, report("s1", L_중2_기울기))).skipped).toBe("no-track");
  });
});

describe("ingestReport — 컨테이너 생명주기", () => {
  it("신규 학생 → 컨테이너 open + 첫 엔트리 + (opened, forward) 이벤트", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    const res = await ingestReport(client, report("s1", L_중2_절편));
    expect(res.event).toBe("forward");
    expect(db.progress_containers).toHaveLength(1);
    const c = db.progress_containers[0];
    expect(c.track).toBe("current"); // 중2 학생·중2 진도
    expect(c.chapter_count).toBe(1);
    expect(c.status).toBe("active");
    expect(c.last_position).toBe(positionOf(L_중2_절편)!.position);
    expect(db.progress_entries).toHaveLength(1);
    expect(db.progress_events.map((e) => e.event_type).sort()).toEqual(["container_opened", "forward"]);
  });

  it("전진(다음 차시) → 같은 컨테이너 count 2, 엔트리 2", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    await ingestReport(client, report("s1", L_중2_절편));
    const res = await ingestReport(client, report("s1", L_중2_기울기));
    expect(res.event).toBe("forward");
    expect(db.progress_containers).toHaveLength(1);
    expect(db.progress_containers[0].chapter_count).toBe(2);
    expect(db.progress_entries).toHaveLength(2);
  });

  it("점프(≥20) → 이전 errored + 새 컨테이너 open, 엔트리는 새 컨테이너에", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1)); // 복습(초3) → current, pos 1
    const res = await ingestReport(client, report("s1", L_중1_소인수)); // 중1, pos 멀리 → jump
    expect(res.event).toBe("jump_error");
    expect(db.progress_containers).toHaveLength(2);
    const [c1, c2] = db.progress_containers;
    expect(c1.status).toBe("errored");
    expect(c1.error_reason).toBe("jump_error");
    expect(c2.status).toBe("active");
    expect(c2.chapter_count).toBe(1);
    // 엔트리는 둘: 초3(c1) + 중1(c2)
    expect(db.progress_entries).toHaveLength(2);
    expect(db.progress_events.filter((e) => e.event_type === "jump_error")).toHaveLength(1);
    expect(db.progress_events.filter((e) => e.event_type === "container_closed")).toHaveLength(1);
  });

  it("복습/역행(위치 ≤ 직전) → 엔트리 미생성, 이벤트만", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    await ingestReport(client, report("s1", L_중2_기울기)); // 전진
    const res = await ingestReport(client, report("s1", L_중2_절편)); // 이전 차시(역행)
    expect(res.skipped).toBe("review");
    expect(res.event).toBe("regression");
    expect(db.progress_entries).toHaveLength(1); // 새 엔트리 없음
    expect(db.progress_containers[0].chapter_count).toBe(1);
  });

  it("20건 채운 컨테이너 → 다음 전진 시 archived 분할 + 새 컨테이너", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    // 사전 상태: chapter_count 20 활성 컨테이너 직접 주입
    db.progress_containers.push({
      id: "cpre", tenant_id: T, student_id: "s1", track: "current", sequence_number: 1,
      last_position: positionOf(L_중2_절편)!.position, chapter_count: 20, max_jump: 0, status: "active",
    });
    const res = await ingestReport(client, report("s1", L_중2_기울기)); // 다음 차시 → full 분할
    expect(res.event).toBe("container_full");
    expect(db.progress_containers.find((c) => c.id === "cpre").status).toBe("archived");
    const active = db.progress_containers.filter((c) => c.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].chapter_count).toBe(1);
    expect(db.progress_events.filter((e) => e.event_type === "container_closed")).toHaveLength(1);
  });

  it("멱등(엔트리 기반) — 엔트리 있는 보고서 재-ingest → already-ingested, 무추가", async () => {
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    const r = report("s1", L_중2_절편); // 전진 → 엔트리 생성
    await ingestReport(client, r);
    const before = { c: db.progress_containers.length, e: db.progress_entries.length, ev: db.progress_events.length };
    const res = await ingestReport(client, r);
    expect(res.skipped).toBe("already-ingested");
    expect(db.progress_containers).toHaveLength(before.c);
    expect(db.progress_entries).toHaveLength(before.e);
    expect(db.progress_events).toHaveLength(before.ev);
  });

  it("복습 보고서는 엔트리가 없어 재-ingest 시 재실행(멱등 skip 아님)하되 컨테이너·엔트리 불변", async () => {
    // 이벤트 기반 멱등이었으면 부분실패 후 영구 skip → 진도 유실. 엔트리 기반이라 자가복구 여지 유지.
    const { client, db } = makeFake({ s1: { grade: "중2" } });
    await ingestReport(client, report("s1", L_중2_기울기)); // 전진(엔트리 1)
    const rev = report("s1", L_중2_절편); // 이전 차시(복습)
    expect((await ingestReport(client, rev)).skipped).toBe("review");
    const r2 = await ingestReport(client, rev); // 재저장 재-ingest
    expect(r2.skipped).toBe("review"); // already-ingested 아님(엔트리 없음 → 재실행)
    expect(db.progress_entries).toHaveLength(1);
    expect(db.progress_containers[0].chapter_count).toBe(1);
  });
});
