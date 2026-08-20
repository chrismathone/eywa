/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- in-memory supabase 가짜(체이너블 빌더)는 any가 불가피, 일부 인자 미사용 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestReport } from "./ingest";
import { positionOf } from "../curriculum-position";

// ── 최소 in-memory supabase 가짜(ingest가 쓰는 체인만) — 컨테이너 생명주기를 실제 DB처럼 시뮬레이트 ──
// 2026-08-20: 점프 경고의 "같은 선생님" 조회를 덮으려고 lesson_reports 저장소 + lte/neq + 임베드
// + 다중 order를 추가했다. 임베드는 실 PostgREST와 같은 모양(`container.track` 점 표기 필터·inner 드롭)으로 흉내낸다.
type Filter = { op: "eq" | "lte" | "neq"; col: string; val: unknown };
type Store = {
  students: Record<string, { grade: string }>;
  lesson_reports: any[];
  progress_containers: any[];
  progress_entries: any[];
  progress_events: any[];
};

function makeFake(students: Record<string, { grade: string }>) {
  let seq = 0;
  const db: Store = { students: { ...students }, lesson_reports: [], progress_containers: [], progress_entries: [], progress_events: [] };
  // 점 표기(`container.track`)는 임베드 안을 본다 — 실 PostgREST와 같은 규약.
  const valueAt = (row: any, col: string) => {
    if (!col.includes(".")) return row[col];
    const [alias, field] = col.split(".");
    return row[alias!]?.[field!];
  };
  const matches = (row: any, f: Filter) => {
    const v = valueAt(row, f.col);
    if (f.op === "eq") return v === f.val;
    if (f.op === "neq") return v != null && v !== f.val; // NULL <> x = NULL → PostgREST도 제외
    return v != null && (v as any) <= (f.val as any);
  };
  // select 문자열에 임베드가 있으면 붙여 준다(progress_entries → container/report).
  const hydrate = (table: string, cols: string, row: any) => {
    if (table !== "progress_entries") return row;
    const out = { ...row };
    if (cols.includes("progress_containers")) out.container = db.progress_containers.find((c) => c.id === row.container_id) ?? null;
    if (cols.includes("lesson_reports")) out.report = db.lesson_reports.find((r) => r.id === row.report_id) ?? null;
    return out;
  };
  const rowsFor = (table: string, filters: Filter[], cols: string) => {
    if (table === "students") {
      const idFilter = filters.find((f) => f.col === "id");
      return idFilter && filters.every((f) => f.col === "id")
        ? [db.students[idFilter.val as string]].filter(Boolean).map((g) => ({ grade: g!.grade }))
        : [];
    }
    let r = ((db as any)[table] as any[]).map((row) => hydrate(table, cols, row));
    for (const f of filters) r = r.filter((x) => matches(x, f));
    return r;
  };
  function builder(table: string) {
    const st: any = { table, op: null as string | null, payload: null, returning: false, cols: "", filters: [] as Filter[], orders: [] as { col: string; asc: boolean }[], limitN: null as number | null };
    const exec = (mode: "maybeSingle" | "single" | "await") => {
      if (st.op === "insert") {
        const items = Array.isArray(st.payload) ? st.payload : [st.payload];
        // created_at은 정렬 타이브레이커라 삽입 순서대로 단조 증가시킨다(정렬 결정성).
        const ins = items.map((it: any) => ({ id: `id${++seq}`, created_at: `t${String(seq).padStart(6, "0")}`, ...it }));
        (db as any)[table].push(...ins);
        return mode === "await" ? { data: null, error: null } : { data: ins[0], error: null };
      }
      if (st.op === "update") {
        // update는 원본 행을 고쳐야 하므로 임베드 사본(hydrate) 없이 다시 고른다.
        let targets = (db as any)[table] as any[];
        for (const f of st.filters) targets = targets.filter((x) => matches(x, f));
        for (const x of targets) Object.assign(x, st.payload);
        return { data: null, error: null };
      }
      let r = rowsFor(table, st.filters, st.cols);
      for (const o of [...st.orders].reverse()) {
        r = [...r].sort((a, b) => {
          const av = valueAt(a, o.col) ?? "";
          const bv = valueAt(b, o.col) ?? "";
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return cmp * (o.asc ? 1 : -1);
        });
      }
      if (st.limitN != null) r = r.slice(0, st.limitN);
      if (mode === "maybeSingle") return { data: r[0] ?? null, error: null };
      if (mode === "single") return { data: r[0] ?? null, error: r[0] ? null : { message: "no rows" } };
      return { data: r, error: null };
    };
    const b: any = {
      select(cols: string) {
        st.cols = cols ?? "";
        if (st.op === "insert") st.returning = true;
        else st.op = "select";
        return b;
      },
      eq(col: string, val: unknown) { st.filters.push({ op: "eq", col, val }); return b; },
      lte(col: string, val: unknown) { st.filters.push({ op: "lte", col, val }); return b; },
      neq(col: string, val: unknown) { st.filters.push({ op: "neq", col, val }); return b; },
      order(col: string, opts?: { ascending?: boolean }) { st.orders.push({ col, asc: opts?.ascending ?? true }); return b; },
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
/**
 * 보고서 입력 1건 — 실제 저장 흐름처럼 `lesson_reports` 행도 함께 남긴다(점프 경고의 "같은 선생님" 조회가
 * 그 행의 teacher_name을 읽는다). `db`를 안 주면 lesson_reports 없이 입력만 만든다(작성자 미상 = 옛 동작).
 */
const report = (
  studentId: string,
  progress: string,
  subject: string | null = "math",
  opts: { teacherName?: string | null; reportDate?: string; db?: Store } = {},
) => {
  const input = {
    id: `r${++rid}`,
    tenantId: T,
    studentId: studentId,
    reportDate: opts.reportDate ?? "2026-07-09",
    subject,
    progress,
    teacherName: opts.teacherName ?? null,
  };
  opts.db?.lesson_reports.push({ id: input.id, teacher_name: input.teacherName });
  return input;
};

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
/**
 * 진도 점프 경고는 **같은 선생님 자기 줄** 안에서만 낸다(원장 2026-08-20).
 * 억제 = 이벤트를 안 남기는 게 아니라 `resolved_at`을 채워 '자동 확인'으로 닫는 것 —
 * 경고 표면 3곳(원스크린 배지·벨·진도 카드)이 전부 `resolved_at is null`을 보므로 조용해지고 기록은 남는다.
 */
describe("ingestReport — 점프 경고는 같은 선생님 줄에서만", () => {
  const jumpEvent = (db: Store) => db.progress_events.find((e) => e.event_type === "jump_error");

  it("유지: 같은 강사가 자기 줄에서 20 이상 건너뜀 → 미확인(resolved_at null) 경고로 남는다", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김윤하", db }));
    const res = await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김윤하", db }));
    expect(res.event).toBe("jump_error");
    const ev = jumpEvent(db);
    expect(ev.resolved_at).toBeUndefined(); // 억제 아님 → 컬럼을 아예 안 보낸다
    expect(ev.details).toBeNull();
  });

  it("억제: 직전 진도를 **다른 강사**가 썼고 이 강사의 직전이 없다 → 자동 확인 + 사유 기록", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김은정", db }));
    const res = await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김윤하", db }));
    expect(res.event).toBe("jump_error"); // 판정 자체는 그대로(기록은 남는다)
    const ev = jumpEvent(db);
    expect(typeof ev.resolved_at).toBe("string");
    expect(ev.resolved_by).toBeUndefined(); // 시스템 확인 = 확인자 없음
    expect(ev.details).toEqual({ suppressed: "other_teacher", teacherName: "김윤하", sameTeacherLastPosition: null });
  });

  it("억제해도 컨테이너 개폐는 그대로 — 옛 컨테이너 errored + 새 컨테이너 active", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김은정", db }));
    await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김윤하", db }));
    expect(db.progress_containers).toHaveLength(2);
    expect(db.progress_containers[0].status).toBe("errored");
    expect(db.progress_containers[0].error_reason).toBe("jump_error");
    expect(db.progress_containers[1].status).toBe("active");
    expect(db.progress_entries).toHaveLength(2);
  });

  it("작성자 미상(teacher_name 없음) → 비교 불가라 억제", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김윤하", db }));
    const res = await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: null, db }));
    expect(res.event).toBe("jump_error");
    expect(typeof jumpEvent(db).resolved_at).toBe("string");
    expect(jumpEvent(db).details.teacherName).toBeNull();
  });

  it("이름의 공백·대소문자 차이는 같은 강사 — 경고가 유지된다", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: " 김 윤하 ", db }));
    const res = await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김  윤하", db }));
    expect(res.event).toBe("jump_error");
    expect(jumpEvent(db).resolved_at).toBeUndefined();
  });

  it("같은 강사라도 **이 보고서 날짜 뒤**에 쓴 진도와는 비교하지 않는다(재판정에서 결론이 뒤집히지 않게)", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    // 그 강사의 진도가 나중 날짜에만 있다 → 이 보고서 시점엔 비교 대상 없음 = 억제.
    db.lesson_reports.push({ id: "rFuture", teacher_name: "김윤하" });
    db.progress_containers.push({
      id: "cFuture", tenant_id: T, student_id: "s1", track: "current", sequence_number: 9,
      last_position: 400, chapter_count: 1, max_jump: 0, status: "archived",
    });
    db.progress_entries.push({
      id: "eFuture", tenant_id: T, container_id: "cFuture", report_id: "rFuture", student_id: "s1",
      entry_date: "2026-07-20", global_position: 1, created_at: "t000000",
    });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김은정", reportDate: "2026-07-09", db }));
    await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김윤하", reportDate: "2026-07-09", db }));
    expect(typeof jumpEvent(db).resolved_at).toBe("string");
  });

  it("다른 track(선행)의 같은 강사 진도는 비교 대상이 아니다", async () => {
    const { client, db } = makeFake({ s1: { grade: "중3" } });
    // 선행 컨테이너에 같은 강사가 가까운 위치를 써 뒀지만, 현행 track 판정에는 쓰이지 않아야 한다.
    db.lesson_reports.push({ id: "rAhead", teacher_name: "김윤하" });
    db.progress_containers.push({
      id: "cAhead", tenant_id: T, student_id: "s1", track: "ahead", sequence_number: 1,
      last_position: 999, chapter_count: 1, max_jump: 0, status: "archived",
    });
    db.progress_entries.push({
      id: "eAhead", tenant_id: T, container_id: "cAhead", report_id: "rAhead", student_id: "s1",
      entry_date: "2026-07-08", global_position: positionOf(L_중1_소인수)!.position - 1, created_at: "t000000",
    });
    await ingestReport(client, report("s1", L_초3_1, "math", { teacherName: "김은정", db }));
    await ingestReport(client, report("s1", L_중1_소인수, "math", { teacherName: "김윤하", db }));
    // 선행 엔트리를 봤다면 차이가 1이라 억제였을 것이고, 안 봤어도 비교 대상이 없어 억제다 —
    // 두 경우가 같은 결론이라 **비교값(sameTeacherLastPosition)** 으로 구분한다.
    expect(jumpEvent(db).details.sameTeacherLastPosition).toBeNull();
  });
});
