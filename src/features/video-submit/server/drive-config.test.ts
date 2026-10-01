import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetVideoDriveConfigForTest, readVideoDriveConfig, videoDriveConfigFor } from "./drive-config";
import { ENV, OTHER_T, T } from "./test-fixture.test-util";

beforeEach(() => _resetVideoDriveConfigForTest());

describe("Drive 연결 값 — 지점 하나에만", () => {
  it("값이 다 있고 그 지점이면 설정, 아니면 null", () => {
    expect(videoDriveConfigFor(T, ENV)).toMatchObject({ tenantId: T, rootId: ENV.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID });
    expect(videoDriveConfigFor(OTHER_T, ENV)).toBeNull();
    for (const key of Object.keys(ENV)) expect(readVideoDriveConfig({ ...ENV, [key]: "" })).toBeNull();
    expect(readVideoDriveConfig({ ...ENV, CLASSNOTE_VIDEO_TENANT_ID: "not-uuid" })).toBeNull();
  });
  it("설정 객체에 비밀값이 실리지 않는다(로그·응답으로 새지 않게)", () => {
    const config = readVideoDriveConfig(ENV)!;
    expect(JSON.stringify(config)).not.toMatch(/secret|refresh|client/);
  });
  it("인증 실패 오류 문장에 비밀값이 없다", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchImpl);
    const config = readVideoDriveConfig(ENV)!;
    const error = await config.accessToken().catch((e: Error) => e.message);
    expect(String(error)).not.toMatch(/secret|refresh/);
    vi.unstubAllGlobals();
  });
});
