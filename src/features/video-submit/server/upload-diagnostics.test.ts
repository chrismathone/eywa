import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedDb, TOKEN, T, OTHER_T } from "./test-fixture.test-util";
import type { FakeDb } from "./fake-db.test-util";
const m = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.db }));
import { recordUploadEvent } from "./upload-diagnostics";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event = { kind: "failed", sequence: 1, elapsedMs: 50, sentBytes: 40, phase: "transfer", reason: "network", attempt: 6, httpStatus: null, online: false, visibility: "visible", browser: "safari" };
beforeEach(() => { m.db = seedDb(); m.db.tables.homework_video_link_uploads = [{ id, tenant_id: T, link_id: "L1", created_at: new Date().toISOString(), bytes: 100, status: "started" }]; m.db.defineRpc("record_homework_video_upload_event", () => "stored"); });
const send = (patch = {}) => recordUploadEvent({ token: TOKEN, uploadId: id, event, ...patch });
describe("업로드 기록 API 권한", () => {
  it("정상 관측값만 RPC에 전달하고 제출 상태는 바꾸지 않는다", async () => {
    expect(await send({ event: { ...event, secret: "private" } })).toBe(204);
    expect(m.db.rpcCalls[0]?.args.p_event).toEqual(event);
    expect(m.db.tables.homework_video_link_uploads![0]!.status).toBe("started");
  });
  it.each([{ tenant_id: OTHER_T }, { link_id: "other" }])("다른 지점·다른 링크의 번호를 거절한다 %j", async patch => {
    Object.assign(m.db.tables.homework_video_link_uploads![0]!, patch);
    expect(await send()).toBe(404); expect(m.db.rpcCalls).toHaveLength(0);
  });
  it("유효기간 내 시작한 업로드만 만료 뒤에도 기록한다", async () => {
    m.db.tables.homework_video_links![0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await send()).toBe(404);
    m.db.tables.homework_video_link_uploads![0]!.created_at = new Date(Date.now() - 2000).toISOString();
    expect(await send()).toBe(204);
    m.db.tables.homework_video_links![0]!.revoked_at = new Date().toISOString();
    expect(await send()).toBe(404);
  });
  it("파일 크기 초과 진행값·잘못된 UUID는 저장하지 않는다", async () => {
    expect(await send({ event: { ...event, sentBytes: 101 } })).toBe(404);
    expect(await send({ uploadId: "bad" })).toBe(400);
  });
  it("속도 제한과 일시 장애를 구분해 큐가 재시도할 수 있다", async () => {
    m.db.defineRpc("record_homework_video_upload_event", () => "limited"); expect(await send()).toBe(429);
    m.db.defineRpc("record_homework_video_upload_event", () => { throw new Error("offline"); }); expect(await send()).toBe(503);
  });
});
