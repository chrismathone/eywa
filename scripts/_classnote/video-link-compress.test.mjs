import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compressNextLinkVideo } from "./video-link-compress.mjs";
import { extendLease, failureOutcome, judgeLinkVideo, LINK_COMPRESS_MAX_ATTEMPTS, mp4Name } from "./video-link-compress-job.mjs";

// `/v` 영상 사후 압축 — 장부 줄 고르기·잠금·Drive 교체·판정 기록. DB·Drive·ffmpeg는 가짜.
const TENANT = "11111111-1111-4111-8111-111111111111";
const ROOT = "root12345678";
const FILE = "file12345678";
const MARK = "h264-crf22-medium-v1";
const NOW = new Date("2026-10-16T09:00:00.000Z");
const dirs = [];
const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const ORIGINAL = Buffer.alloc(40, 9);
const row = (route = {}) => ({ id: "22222222-2222-4222-8222-222222222222", drive_file_id: FILE, md5: md5(ORIGINAL), bytes: String(ORIGINAL.length),
  route: { rootId: ROOT, classId: "c1", homeworkDate: "2026-10-15", ...route } });

/** 장부 DB 가짜 — 쿼리 글자로 가른다. 판정 기록(`archive`)과 쿼리 목록을 남긴다. */
function fakeSql(candidate) {
  const calls = [];
  const state = { archive: null, released: false, leaseGone: false, recordFails: 0, stolen: false };
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("homework_video_drive_roots")) return Promise.resolve([{ tenant_id: TENANT, connection_id: null }]);
    if (text.includes("select id, drive_file_id, md5, bytes, route")) { state.pickLimit = values.at(-1); return Promise.resolve(candidate ? [candidate] : []); }
    if (text.includes("set lock_token = ?, locked_at = now()")) return Promise.resolve(candidate ? [candidate] : []);
    if (text.includes("jsonb_build_object('archive'")) {
      if (state.recordFails > 0) { state.recordFails--; return Promise.reject(new Error("db down")); }
      if (state.stolen) return Promise.resolve([]);
      state.archive = values.find((v) => v?.__json)?.__json; return Promise.resolve([{ id: candidate.id }]);
    }
    if (text.includes("set locked_at = now()")) return Promise.resolve(state.leaseGone ? [] : [{ id: candidate.id }]);
    if (text.includes("set lock_token = null, locked_at = null")) { state.released = true; return Promise.resolve([]); }
    return Promise.resolve([]);
  };
  sql.json = (value) => ({ __json: value });
  return { sql, calls, state };
}

/** Drive 가짜 — 파일 하나(머리 버전 r1 = 원본). 내용 교체가 끝나면 r2(압축본)가 머리. */
function fakeDrive({ meta = {}, changeBeforeUpload = false, quota = {}, startStatus = null, staleAfterUpload = false } = {}) {
  const file = { id: FILE, name: "학생_반_2026-10-16_1430.mov", mimeType: "video/quicktime", size: String(ORIGINAL.length), md5Checksum: md5(ORIGINAL),
    trashed: false, ownedByMe: true, headRevisionId: "r1", properties: {}, ...meta };
  const log = [];
  let reads = 0;
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const method = init.method ?? "GET";
    log.push(`${method} ${url.replace(/\?.*$/, "")}`);
    if (url.includes("alt=media")) {
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      return new Response(ORIGINAL.subarray(Number(a), Number(b) + 1), { status: 206, headers: { "content-range": `bytes ${a}-${b}/${ORIGINAL.length}` } });
    }
    if (url.includes("/about")) return json({ storageQuota: quota });
    if (method === "PATCH" && url.startsWith("https://www.googleapis.com/upload/")) {
      if (startStatus) return json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, startStatus);
      file.pendingMeta = JSON.parse(init.body);
      return new Response(null, { headers: { location: "https://www.googleapis.com/upload/drive/v3/files/x?upload_id=s" } });
    }
    if (method === "PUT") {
      if (init.headers["Content-Range"].startsWith("bytes */")) return new Response(null, { status: 308 });
      Object.assign(file, { md5Checksum: md5(Buffer.from(init.body)), size: String(init.body.byteLength), headRevisionId: "r2",
        name: file.pendingMeta.name, mimeType: file.pendingMeta.mimeType, properties: { ...file.properties, ...file.pendingMeta.properties } });
      return json({ id: FILE });
    }
    if (url.includes("/revisions/")) return new Response(null, { status: 204 });
    if (url.includes("/revisions")) return json({ revisions: [{ id: "r1", md5Checksum: md5(ORIGINAL) }, { id: "r2", md5Checksum: file.md5Checksum }] });
    if (method === "PATCH") { file.properties = { ...file.properties, ...JSON.parse(init.body).properties }; return json(file); }
    reads++;
    if (changeBeforeUpload && reads === 2) return json({ ...file, md5Checksum: "changed", headRevisionId: "r9" });
    if (staleAfterUpload && file.headRevisionId === "r2") return json({ ...file, md5Checksum: undefined });
    return json(file);
  });
  return { file, log, fetchImpl };
}

async function deps(db, drive, extra = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "aywa-link-")); dirs.push(workDir);
  const small = Buffer.alloc(12, 3);
  return {
    sql: db.sql, log: vi.fn(), env: {}, setting: { enabled: true, rootId: ROOT, connectionId: null, source: "saved", schema: "complete" },
    workDir, now: () => NOW, token: () => "tok-1", fetchImpl: drive.fetchImpl, sleep: async () => {},
    credentialsFor: vi.fn(async () => ({ kind: "pc", connectionId: null, accessToken: async () => "test-only" })),
    prepare: vi.fn(async (local) => {
      const out = local.filePath.replace(/\.mp4$/, ".aywa.mp4"); await writeFile(out, small);
      return { marker: MARK, filePath: out, md5: md5(small), bytes: small.length, sha256: "s" };
    }),
    freeBytes: async () => Infinity, remove: unlink, report: vi.fn(), ...extra,
  };
}

describe("compressNextLinkVideo", () => {
  it("원본을 받아 줄인 뒤 같은 파일에 새 버전으로 올리고 원본 버전을 지운다 — DB 지문(md5·bytes)은 그대로", async () => {
    const db = fakeSql(row()); const drive = fakeDrive(); const d = await deps(db, drive);
    expect(await compressNextLinkVideo(TENANT, d)).toEqual({ worked: true });
    expect(db.state.archive?.reason ?? null).toBeNull();
    expect(db.state.archive).toMatchObject({ state: "done", compression: MARK, driveBytes: 12, sourceBytes: 40, oldRevision: "deleted", at: NOW.toISOString() });
    expect(drive.file).toMatchObject({ name: "학생_반_2026-10-16_1430.mp4", mimeType: "video/mp4", headRevisionId: "r2", size: "12" });
    expect(drive.file.properties).toEqual({ aywaCompressed: MARK, aywaSourceMd5: md5(ORIGINAL), aywaSourceBytes: "40", aywaUploadMd5: md5(Buffer.alloc(12, 3)), aywaUploadBytes: "12" });
    expect(drive.file.pendingMeta).not.toHaveProperty("appProperties");
    expect(drive.log).toContain(`DELETE https://www.googleapis.com/drive/v3/files/${FILE}/revisions/r1`);
    expect(drive.log.some((line) => line.endsWith("/revisions/r2"))).toBe(false);
    // 고치는 칸은 잠금·route뿐 — 원본 지문(md5·bytes)·상태·시도 횟수는 쓰지 않는다.
    const setClauses = db.calls.filter((text) => /^\s*update\b/.test(text)).map((text) => text.split(/\bwhere\b/)[0]);
    expect(setClauses.length).toBeGreaterThan(0);
    expect(setClauses.some((text) => /\b(md5|bytes|status|attempts|available_at)\s*=/.test(text))).toBe(false);
    expect(await readdir(d.workDir)).toEqual([]);
    expect(d.report).toHaveBeenCalledWith({ processed: 1 });
  });

  it("줄일 게 없다고 판단하면(절감 부족 등) 내용은 그대로 두고 표식만 남긴다", async () => {
    const db = fakeSql(row()); const drive = fakeDrive();
    const d = await deps(db, drive, { prepare: vi.fn(async () => ({ marker: "kept-savings" })) });
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toMatchObject({ state: "kept", compression: "kept-savings", driveBytes: 40 });
    expect(drive.file).toMatchObject({ headRevisionId: "r1", md5Checksum: md5(ORIGINAL) });
    expect(drive.file.properties).toMatchObject({ aywaCompressed: "kept-savings", aywaUploadMd5: md5(ORIGINAL), aywaUploadBytes: "40" });
    expect(drive.log.some((line) => line.includes("/upload/"))).toBe(false);
  });

  it("올린 뒤 내용이 바뀌었거나 · 휴지통이면 내려받지 않고 건너뛴다", async () => {
    for (const [meta, reason] of [[{ md5Checksum: "other" }, "changed"], [{ trashed: true }, "gone"]]) {
      const db = fakeSql(row()); const drive = fakeDrive({ meta }); const d = await deps(db, drive);
      await compressNextLinkVideo(TENANT, d);
      expect(db.state.archive).toMatchObject({ state: "skipped", reason });
      expect(d.prepare).not.toHaveBeenCalled();
      expect(drive.log.some((line) => line.includes("alt=media"))).toBe(false);
    }
  });

  it("저장 계정이 고칠 수 없는 파일은 끝내지 않고 나중에(횟수 안 셈) · 편집할 수 있는 공유 드라이브 파일은 처리한다", async () => {
    const foreign = fakeSql(row()); const drive = fakeDrive({ meta: { ownedByMe: false } }); const d = await deps(foreign, drive);
    await compressNextLinkVideo(TENANT, d);
    expect(foreign.state.archive).toMatchObject({ state: "retry", attempts: 0, waits: 1, retryAt: "2026-10-16T10:00:00.000Z" });
    expect(drive.log.some((line) => line.includes("alt=media"))).toBe(false);
    // 공유 드라이브 — `ownedByMe`가 비어 있고 드라이브가 소유자다.
    const shared = fakeSql(row()); const sharedDrive = fakeDrive({ meta: { ownedByMe: undefined, driveId: "0Ashared123", capabilities: { canEdit: true } } });
    await compressNextLinkVideo(TENANT, await deps(shared, sharedDrive));
    expect(shared.state.archive).toMatchObject({ state: "done" });
    const readOnly = fakeSql(row());
    await compressNextLinkVideo(TENANT, await deps(readOnly, fakeDrive({ meta: { ownedByMe: undefined, driveId: "0Ashared123", capabilities: { canEdit: false } } })));
    expect(readOnly.state.archive).toMatchObject({ state: "retry", attempts: 0 });
  });

  it("Drive에 압축본 자리(원본의 85%)가 없으면 받지 않는다 · 공유 드라이브는 개인 용량을 안 본다 · 교체가 공간 한도로 거절되면 세지 않는다", async () => {
    const full = fakeSql(row()); const drive = fakeDrive({ quota: { limit: "100", usage: "67" } }); // 남은 33 < 40 × 0.85
    await compressNextLinkVideo(TENANT, await deps(full, drive));
    expect(full.state.archive).toMatchObject({ state: "retry", attempts: 0, waits: 1 });
    expect(drive.log.some((line) => line.includes("alt=media"))).toBe(false);
    const enough = fakeSql(row());
    await compressNextLinkVideo(TENANT, await deps(enough, fakeDrive({ quota: { limit: "100", usage: "66" } }))); // 남은 34
    expect(enough.state.archive).toMatchObject({ state: "done" });
    const shared = fakeSql(row());
    await compressNextLinkVideo(TENANT, await deps(shared, fakeDrive({ quota: { limit: "100", usage: "100" },
      meta: { ownedByMe: undefined, driveId: "0Ashared123", capabilities: { canEdit: true } } })));
    expect(shared.state.archive).toMatchObject({ state: "done" });
    const refused = fakeSql(row());
    await compressNextLinkVideo(TENANT, await deps(refused, fakeDrive({ startStatus: 403 })));
    expect(refused.state.archive).toMatchObject({ state: "retry", attempts: 0, waits: 1 });
  });

  it("긴 인코딩 뒤 잠금이 남의 것이면 교체하지 않는다(세지 않음) · 교체 뒤 해시가 늦으면 다음에 표식으로 잇는다", async () => {
    const db = fakeSql(row()); const drive = fakeDrive();
    const d = await deps(db, drive, { prepare: vi.fn(async (local) => { db.state.leaseGone = true;
      const out = local.filePath.replace(/[.]mp4$/, ".aywa.mp4"); await writeFile(out, Buffer.alloc(12, 3));
      return { marker: MARK, filePath: out, md5: md5(Buffer.alloc(12, 3)), bytes: 12, sha256: "s" }; }) });
    await compressNextLinkVideo(TENANT, d);
    expect(drive.log.some((line) => line.includes("/upload/"))).toBe(false);
    expect(await readdir(d.workDir)).toEqual([]);
    const slow = fakeSql(row()); const slowDrive = fakeDrive({ staleAfterUpload: true });
    await compressNextLinkVideo(TENANT, await deps(slow, slowDrive));
    expect(slow.state.archive).toMatchObject({ state: "retry", attempts: 0 });
    expect(slowDrive.log.some((line) => line.includes("DELETE"))).toBe(false);
  });

  it("하트비트 — 오류는 세 번 잇달아야 잃은 것 · 다시 늘리면 되돌린다 · 0행(남이 가져감)은 잃은 것", async () => {
    const track = { heartbeatFails: 0, leaseLost: false };
    let mode = "error";
    const sql = () => (mode === "error" ? Promise.reject(new Error("db down")) : Promise.resolve(mode === "ok" ? [{ id: 1 }] : []));
    for (let i = 0; i < 2; i++) await extendLease(sql, TENANT, row(), "tok", track);
    expect(track.leaseLost).toBe(false);
    await extendLease(sql, TENANT, row(), "tok", track);
    expect(track.leaseLost).toBe(true);
    mode = "ok";
    expect(await extendLease(sql, TENANT, row(), "tok", track)).toBe(true);
    expect(track).toMatchObject({ leaseLost: false, heartbeatFails: 0 });
    mode = "gone";
    expect(await extendLease(sql, TENANT, row(), "tok", track)).toBe(false);
    expect(track.leaseLost).toBe(true);
  });

  it("잠금이 다른 실행으로 넘어갔으면 기록이 안 돼도 쉬는 줄로 세지 않는다 · 센 실패만 실패로 보고한다", async () => {
    const stolen = fakeSql(row()); stolen.state.stolen = true; const unsaved = new Map();
    const d = await deps(stolen, fakeDrive(), { unsaved });
    await compressNextLinkVideo(TENANT, d);
    expect(unsaved.size).toBe(0);
    expect(d.log.mock.calls.flat().join("\n")).toContain("다른 실행으로 넘어가");
    // 앞서 두 번 센 줄이 PC 사정(디스크)으로 미뤄질 때 — 실패 보고·횟수 표기 없음.
    const disk = fakeSql(row({ archive: { state: "retry", attempts: 2 } }));
    const dd = await deps(disk, fakeDrive(), { freeBytes: async () => 10 });
    await compressNextLinkVideo(TENANT, dd);
    expect(disk.state.archive).toMatchObject({ state: "retry", attempts: 2, waits: 1 });
    expect(dd.report).not.toHaveBeenCalled();
    expect(dd.log.mock.calls.flat().join("\n")).not.toContain("(2/5)");
    // 센 실패는 보고한다.
    const enc = fakeSql(row()); const de = await deps(enc, fakeDrive(), { prepare: vi.fn(async () => null) });
    await compressNextLinkVideo(TENANT, de);
    expect(de.report).toHaveBeenCalledWith({ ok: false });
  });

  it("판정을 못 남기면 두 번 더 해 보고 · 세 번 연달아 못 남긴 줄은 이번 실행 동안 쉰다", async () => {
    const db = fakeSql(row()); db.state.recordFails = 2; const unsaved = new Map();
    await compressNextLinkVideo(TENANT, await deps(db, fakeDrive(), { unsaved }));
    expect(db.state.archive).toMatchObject({ state: "done" });
    expect(unsaved.size).toBe(0);
    const down = fakeSql(row()); down.state.recordFails = 99;
    for (let i = 0; i < 3; i++) expect(await compressNextLinkVideo(TENANT, await deps(down, fakeDrive(), { unsaved }))).toEqual({ worked: true });
    expect(unsaved.get(row().id)).toBe(3);
    expect(await compressNextLinkVideo(TENANT, await deps(down, fakeDrive(), { unsaved }))).toEqual({ worked: false });
    // 쉬는 줄 수만큼 더 읽는다(앞자리를 막지 않게).
    expect(down.state.pickLimit).toBe(5);
  });

  it("지난 실행이 남긴 이 줄의 임시 파일은 어느 길로 끝나든 치운다 · 끝내는 중이면 새 줄을 집지 않는다", async () => {
    const small = Buffer.alloc(12, 3);
    const meta = { md5Checksum: md5(small), size: "12", headRevisionId: "r2",
      properties: { aywaCompressed: MARK, aywaSourceMd5: md5(ORIGINAL), aywaSourceBytes: "40", aywaUploadMd5: md5(small), aywaUploadBytes: "12" } };
    const db = fakeSql(row()); const d = await deps(db, fakeDrive({ meta }));
    await writeFile(path.join(d.workDir, `link-${row().id}.mp4`), ORIGINAL);
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toMatchObject({ state: "done" });
    expect(await readdir(d.workDir)).toEqual([]);
    const abort = new AbortController(); abort.abort(new Error("작업 종료 요청"));
    const idle = fakeSql(row());
    expect(await compressNextLinkVideo(TENANT, await deps(idle, fakeDrive(), { signal: abort.signal }))).toEqual({ worked: false });
    expect(idle.calls.some((text) => text.includes("set lock_token = ?"))).toBe(false);
  });

  it("받고 줄이는 사이 파일이 바뀌면 덮어쓰지 않는다", async () => {
    const db = fakeSql(row()); const drive = fakeDrive({ changeBeforeUpload: true }); const d = await deps(db, drive);
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toMatchObject({ state: "skipped", reason: "changed" });
    expect(drive.log.some((line) => line.includes("/upload/"))).toBe(false);
  });

  it("판정 기록만 잃은 파일(Drive 표식이 이 원본) — 다시 받지 않고 남은 원본 버전만 지운 뒤 기록한다", async () => {
    const small = Buffer.alloc(12, 3);
    const meta = { md5Checksum: md5(small), size: "12", headRevisionId: "r2",
      properties: { aywaCompressed: MARK, aywaSourceMd5: md5(ORIGINAL), aywaSourceBytes: "40", aywaUploadMd5: md5(small), aywaUploadBytes: "12" } };
    const db = fakeSql(row()); const drive = fakeDrive({ meta }); const d = await deps(db, drive);
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toMatchObject({ state: "done", compression: MARK, driveBytes: 12, oldRevision: "deleted" });
    expect(d.prepare).not.toHaveBeenCalled();
    expect(drive.log.some((line) => line.includes("alt=media"))).toBe(false);
  });

  it("끝내는 신호(연동 앱 종료·업데이트)로 멈추면 시도로 세지 않고 잠금만 푼다", async () => {
    const db = fakeSql(row()); const drive = fakeDrive(); const abort = new AbortController();
    const d = await deps(db, drive, { signal: abort.signal, prepare: vi.fn(async () => { abort.abort(new Error("작업 종료 요청")); throw new Error("작업 종료 요청"); }) });
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toBeNull();
    expect(db.state.released).toBe(true);
    expect(await readdir(d.workDir)).toEqual([]);
  });

  it("압축 실패는 다음에 다시(횟수를 센다) · 인증·디스크 같은 PC 사정은 세지 않는다", async () => {
    const db = fakeSql(row()); const d = await deps(db, fakeDrive(), { prepare: vi.fn(async () => null) });
    await compressNextLinkVideo(TENANT, d);
    expect(db.state.archive).toMatchObject({ state: "retry", attempts: 1, retryAt: "2026-10-16T09:30:00.000Z" });
    const auth = fakeSql(row({ archive: { state: "retry", attempts: 2 } }));
    await compressNextLinkVideo(TENANT, await deps(auth, fakeDrive(), { credentialsFor: vi.fn(async () => { throw new Error("x"); }) }));
    expect(auth.state.archive).toMatchObject({ state: "retry", attempts: 2, retryAt: "2026-10-16T10:00:00.000Z" });
    const disk = fakeSql(row());
    await compressNextLinkVideo(TENANT, await deps(disk, fakeDrive(), { freeBytes: async () => 10 }));
    expect(disk.state.archive).toMatchObject({ state: "retry", attempts: 0, reason: "발송 PC 디스크 공간이 부족합니다." });
  });

  it("할 일이 없으면 Drive를 부르지 않는다", async () => {
    const db = fakeSql(null); const drive = fakeDrive();
    expect(await compressNextLinkVideo(TENANT, await deps(db, drive))).toEqual({ worked: false });
    expect(drive.fetchImpl).not.toHaveBeenCalled();
  });

  it("대상 고르기 — `/v` 줄 · 업로드 끝 · 저장 폴더 찍힘 · 판정 없음 또는 다시 할 때 · 잠금이 비었거나 10분 넘게 멈춤", async () => {
    const db = fakeSql(null);
    await compressNextLinkVideo(TENANT, await deps(db, fakeDrive()));
    const pick = db.calls[0];
    for (const part of ["source = 'link'", "status = 'uploaded'", "coalesce(route->>'rootId', '') <> ''", "route->'archive' is null",
      "route->'archive'->>'state' = 'retry'", "locked_at < now() - interval '10 minutes'", "order by uploaded_at desc"]) expect(pick).toContain(part);
  });
});

describe("판정 도우미", () => {
  it("judgeLinkVideo — 영상 형식 아님은 건너뛴다", () => {
    const r = row();
    expect(judgeLinkVideo({ md5Checksum: r.md5, size: "40", ownedByMe: true, mimeType: "application/pdf" }, r)).toEqual({ skip: "not-video" });
    expect(judgeLinkVideo(null, r)).toEqual({ skip: "gone" });
    expect(judgeLinkVideo({ md5Checksum: r.md5, size: "40", ownedByMe: true, mimeType: "video/mp4" }, r)).toEqual({ ok: true });
  });

  it("mp4Name — 끝을 .mp4로", () => {
    expect(mp4Name("a_b.mov")).toBe("a_b.mp4");
    expect(mp4Name("a_b.mp4")).toBe("a_b.mp4");
    expect(mp4Name("a_b")).toBe("a_b.mp4");
    expect(mp4Name("")).toBeNull();
  });

  it("failureOutcome — 마지막 시도는 그만둔다(원본 그대로)", () => {
    const r = row({ archive: { state: "retry", attempts: LINK_COMPRESS_MAX_ATTEMPTS - 1 } });
    expect(failureOutcome(r, new Error("Drive 영상 교체 시작 HTTP 403"), NOW)).toEqual({ state: "failed", attempts: LINK_COMPRESS_MAX_ATTEMPTS, reason: "Drive 영상 교체 시작 HTTP 403" });
    expect(failureOutcome(row(), new Error("Drive 영상 확인 HTTP 401"), NOW)).toMatchObject({ state: "retry", attempts: 0 });
  });

  it("failureOutcome — PC·설정 사정은 세지 않고 간격만 두 배씩 벌린다(하루 상한) · 요청 한도 429도", () => {
    const wait = (waits, attempts = 2) => failureOutcome(row({ archive: { state: "retry", attempts, waits } }), Object.assign(new Error("x"), { later: true }), NOW);
    expect(wait(undefined)).toMatchObject({ attempts: 2, waits: 1, retryAt: "2026-10-16T10:00:00.000Z" });
    expect(wait(3)).toMatchObject({ attempts: 2, waits: 4, retryAt: "2026-10-16T17:00:00.000Z" });
    expect(wait(20)).toMatchObject({ waits: 21, retryAt: "2026-10-17T09:00:00.000Z" });
    expect(failureOutcome(row(), new Error("Drive 영상 확인 HTTP 429"), NOW)).toMatchObject({ state: "retry", attempts: 0, waits: 1 });
  });
});
