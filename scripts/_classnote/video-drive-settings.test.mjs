import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueParentVideos } from "./video-inbox.mjs";
import { loadWorkerVideoDriveSetting, resolveVideoJobRoot, videoArchiveHeartbeat, workerVideoRootOwned, workerVideoTargetMatches } from "./video-drive-settings.mjs";

vi.mock("./video-teacher-route.mjs", () => ({
  loadVideoTeacher: async () => ({ studentId: "stu", subject: "math", teacherId: "tea" }),
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ROOT = "savedRoot12345";
const ENV_ROOT = "envFolder123456";
const ENV_KEYS = ["CLASSNOTE_VIDEO_DRIVE_FOLDER_ID", "CLASSNOTE_VIDEO_TENANT_ID", "CLASSNOTE_TENANT_ID"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const missing = Object.assign(new Error('relation "homework_video_drive_settings" does not exist'), { code: "42P01" });
const denied = Object.assign(new Error("permission denied"), { code: "42501" });
const post = { id: 20, child: 30, cls: 40, class_name: "(수학)학생", author: { type: "parent" }, attached_video: { id: 50 } };

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function scripted(handler) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    calls.push({ text, values });
    const result = handler(text, values);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  sql.json = (value) => value;
  return { sql, calls };
}

/** 설정·루트·등록부를 따로 답한다. 빠진 표는 missing, 행 없음은 []. */
function tables({ settings = missing, roots = missing, registry = [] } = {}) {
  return scripted((text) => {
    if (text.includes("homework_video_drive_settings")) return settings;
    if (text.includes("homework_video_drive_roots")) return roots;
    if (text.includes("classnote_video_folders")) return registry;
    return missing;
  });
}

const namedEnv = { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: TENANT, CLASSNOTE_TENANT_ID: OTHER };
const shaped = (setting, schema) => ({ connectionId: null, ...setting, schema });

describe("워커 영상 저장 설정", () => {
  it("표가 없고 env 지점이 자기 지점이면 그 폴더만 레거시다", async () => {
    process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = "processEnvRoot1";
    process.env.CLASSNOTE_VIDEO_TENANT_ID = OTHER;
    const { sql, calls } = tables();
    const got = await loadWorkerVideoDriveSetting(sql, TENANT, { env: namedEnv });
    expect(got).toEqual(shaped({ enabled: true, rootId: ENV_ROOT, source: "legacy" }, "absent"));
    expect(calls.some((call) => call.text.includes("homework_video_drive_settings"))).toBe(true);
    expect(calls.some((call) => call.text.includes("classnote_video_folders"))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("processEnvRoot1");
  });

  it("CLASSNOTE_TENANT_ID 만 있으면 그 지점이 레거시 소유다", async () => {
    const { sql } = tables();
    const got = await loadWorkerVideoDriveSetting(sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_TENANT_ID: TENANT },
    });
    expect(got).toEqual(shaped({ enabled: true, rootId: ENV_ROOT, source: "legacy" }, "absent"));
  });

  it("다른 지점 env 는 레거시가 아니고, 영상 지점이 있으면 일반 지점 env 로 넓히지 않는다", async () => {
    const other = tables();
    expect(await loadWorkerVideoDriveSetting(other.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER },
    })).toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "absent"));
    const namedWins = tables();
    expect(await loadWorkerVideoDriveSetting(namedWins.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER, CLASSNOTE_TENANT_ID: TENANT },
    })).toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "absent"));
  });

  it("env 지점이 없으면 폴더 등록부의 유일한 소유자만 레거시다", async () => {
    const only = tables({ registry: [{ tenant_id: TENANT }] });
    expect(await loadWorkerVideoDriveSetting(only.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual(shaped({ enabled: true, rootId: ENV_ROOT, source: "legacy" }, "absent"));
    const shared = tables({ registry: [{ tenant_id: TENANT }, { tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(shared.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "absent"));
    const foreign = tables({ registry: [{ tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(foreign.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "absent"));
  });

  it("정상 스키마에 설정 행이 없으면 이 지점 소유 루트 행이 있을 때만 기존 env 연결을 유지한다", async () => {
    const absent = tables({ settings: [], roots: [], registry: [] });
    expect(await loadWorkerVideoDriveSetting(absent.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
    expect(absent.calls.some((call) => call.text.includes("homework_video_drive_settings"))).toBe(true);
    expect(absent.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(true);
    const seeded = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(seeded.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: true, rootId: ENV_ROOT, source: "legacy" }, "complete"));
    const uniqueOnly = tables({ settings: [], roots: [], registry: [{ tenant_id: TENANT }] });
    expect(await loadWorkerVideoDriveSetting(uniqueOnly.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
    const registryGone = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: missing });
    expect(await loadWorkerVideoDriveSetting(registryGone.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
    const namedElsewhere = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(namedElsewhere.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER, CLASSNOTE_TENANT_ID: TENANT },
    })).toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
  });

  it("해제 행은 루트 표가 없어도 꺼진 채로 남고 env 로 돌아가지 않는다", async () => {
    const off = tables({
      settings: [{ enabled: false, root_folder_id: ROOT }],
      roots: missing,
    });
    expect(await loadWorkerVideoDriveSetting(off.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "saved" }, "folders"));
    expect(off.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(false);
    expect(off.calls.some((call) => call.text.includes("classnote_video_folders"))).toBe(false);
  });

  it("이름이 맞아도 루트 표나 등록부의 다른 지점 소유면 레거시를 거절한다", async () => {
    const rootsForeign = tables({ settings: [], roots: [{ tenant_id: OTHER }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(rootsForeign.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
    const registryForeign = tables({ settings: [], roots: [], registry: [{ tenant_id: TENANT }, { tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(registryForeign.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "none" }, "complete"));
  });

  it("표 없음이 아닌 조회 오류는 꺼짐과 구분하고 env 로 가지 않는다", async () => {
    const { sql, calls } = scripted(() => denied);
    expect(await loadWorkerVideoDriveSetting(sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: TENANT },
    })).toEqual(shaped({ enabled: false, rootId: null, source: "unknown", error: true }, "unknown"));
    expect(calls).toHaveLength(1);
    const legacyBroken = scripted((text) => text.includes("homework_video_drive_settings") ? missing : denied);
    expect(await loadWorkerVideoDriveSetting(legacyBroken.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "unknown", error: true }, "unknown"));
  });

  it("켠 설정은 이 지점이 소유한 루트만 쓴다", async () => {
    const saved = { enabled: true, root_folder_id: ROOT, connection_id: null };
    const ok = tables({ settings: [saved], roots: [{ tenant_id: TENANT, connection_id: null }] });
    expect(await loadWorkerVideoDriveSetting(ok.sql, TENANT, { env: {} })).toEqual(shaped({ enabled: true, rootId: ROOT, source: "saved" }, "complete"));
    const drifted = tables({ settings: [saved], roots: [{ tenant_id: TENANT, connection_id: "33333333-3333-4333-8333-333333333333" }] });
    expect(await loadWorkerVideoDriveSetting(drifted.sql, TENANT, { env: {} }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "saved" }, "complete"));
    const foreign = tables({ settings: [saved], roots: [{ tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(foreign.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "saved" }, "complete"));
    const empty = tables({ settings: [{ enabled: true, root_folder_id: null, connection_id: null }] });
    expect(await loadWorkerVideoDriveSetting(empty.sql, TENANT, { env: {} })).toEqual(shaped({ enabled: false, rootId: null, source: "saved" }, "complete"));
    expect(empty.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(false);
    const rootsMissing = tables({ settings: [saved], roots: missing });
    expect(await loadWorkerVideoDriveSetting(rootsMissing.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "saved" }, "complete"));
    const rootsBroken = tables({ settings: [saved], roots: denied });
    expect(await loadWorkerVideoDriveSetting(rootsBroken.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "unknown", error: true }, "unknown"));
  });

  it("소유 확인은 루트 행이 있으면 그 지점이고, 행이 없을 때는 다른 지점 소유를 거른 뒤에만 레거시다", async () => {
    const owned = tables({ roots: [{ tenant_id: TENANT }] });
    expect(await workerVideoRootOwned(owned.sql, TENANT, ROOT, { env: {} })).toBe(true);
    const foreign = tables({ roots: [{ tenant_id: OTHER }] });
    expect(await workerVideoRootOwned(foreign.sql, TENANT, ROOT, { env: namedEnv })).toBe(false);
    const none = tables({ roots: [] });
    expect(await workerVideoRootOwned(none.sql, TENANT, ROOT, { env: {} })).toBe(false);
    const promoted = tables({ roots: [], registry: [] });
    expect(await workerVideoRootOwned(promoted.sql, TENANT, ENV_ROOT, { env: namedEnv })).toBe(false);
    expect(await workerVideoRootOwned(promoted.sql, TENANT, ROOT, { env: namedEnv })).toBe(false);
    const blocked = tables({ roots: [], registry: [{ tenant_id: OTHER }] });
    expect(await workerVideoRootOwned(blocked.sql, TENANT, ENV_ROOT, { env: namedEnv })).toBe(false);
    const legacy = tables({ roots: missing, registry: [] });
    expect(await workerVideoRootOwned(legacy.sql, TENANT, ENV_ROOT, { env: namedEnv })).toBe(true);
    const broken = scripted(() => denied);
    await expect(workerVideoRootOwned(broken.sql, TENANT, ROOT, { env: namedEnv })).rejects.toMatchObject({ code: "42501" });
    const legacyBroken = scripted((text) => text.includes("homework_video_drive_roots") ? missing : denied);
    await expect(workerVideoRootOwned(legacyBroken.sql, TENANT, ENV_ROOT, { env: namedEnv })).rejects.toThrow("영상 저장 폴더 설정을 확인하지 못했습니다.");
  });

  it("새 작업만 활성 루트를 쓰고, 찍힌 루트는 설정이 꺼져도 유지한다", () => {
    const active = { enabled: true, rootId: ROOT, source: "saved" };
    const off = { enabled: false, rootId: null, source: "saved" };
    expect(resolveVideoJobRoot(active, null)).toEqual({ kind: "active", rootId: ROOT, connectionId: null, invalid: false });
    expect(resolveVideoJobRoot(active, { rootId: "oldRoot1234567" }).kind).toBe("pinned");
    expect(resolveVideoJobRoot(off, { rootId: "oldRoot1234567" })).toEqual({ kind: "pinned", rootId: "oldRoot1234567", connectionId: null, invalid: false });
    expect(resolveVideoJobRoot(off, null)).toEqual({ kind: "skip", rootId: null, connectionId: null, invalid: false });
    const linked = "33333333-3333-4333-8333-333333333333";
    expect(resolveVideoJobRoot({ ...active, connectionId: linked }, null)).toEqual({ kind: "active", rootId: ROOT, connectionId: linked, invalid: false });
    expect(resolveVideoJobRoot(off, { rootId: "oldRoot1234567", connectionId: linked }).connectionId).toBe(linked);
  });

  it("하트비트 루트는 켜진 실제 설정만 담고 env 를 대신 적지 않는다", () => {
    const linked = "33333333-3333-4333-8333-333333333333";
    expect(videoArchiveHeartbeat({ enabled: true, rootId: ROOT })).toEqual({ enabled: true, folderId: ROOT, connectionId: null });
    expect(videoArchiveHeartbeat({ enabled: true, rootId: ROOT, connectionId: linked })).toEqual({ enabled: true, folderId: ROOT, connectionId: linked });
    expect(videoArchiveHeartbeat({ enabled: false, rootId: ROOT, connectionId: linked })).toEqual({ enabled: false, folderId: null, connectionId: null });
    expect(videoArchiveHeartbeat({ enabled: false, rootId: null, source: "unknown", error: true })).toEqual({ enabled: false, folderId: null, connectionId: null });
    expect(videoArchiveHeartbeat(null)).toEqual({ enabled: false, folderId: null, connectionId: null });
  });

  it("connection_id 칸이 없으면 폴더 규칙만 쓰고, 다른 조회 오류는 폴백하지 않는다", async () => {
    const column = Object.assign(new Error('column "connection_id" does not exist'), { code: "42703" });
    const handled = scripted((text) => {
      if (text.includes("connection_id") && text.includes("homework_video_drive_settings")) return column;
      if (text.includes("homework_video_drive_settings")) return [{ enabled: true, root_folder_id: ROOT }];
      if (text.includes("homework_video_drive_roots")) return [{ tenant_id: TENANT }];
      return [];
    });
    expect(await loadWorkerVideoDriveSetting(handled.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: true, rootId: ROOT, source: "saved" }, "folders"));
    const otherColumn = scripted(() => Object.assign(new Error('column "version" does not exist'), { code: "42703" }));
    expect(await loadWorkerVideoDriveSetting(otherColumn.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "unknown", error: true }, "unknown"));
  });

  it("루트 조회가 connection_id 42703이어도 폴더만 다시 읽고, 연결 없는 작업은 소유로 인정한다", async () => {
    const column = Object.assign(new Error('column "connection_id" does not exist'), { code: "42703" });
    const handled = scripted((text) => {
      if (text.includes("connection_id")) throw column;
      if (text.includes("homework_video_drive_settings")) return [{ enabled: true, root_folder_id: ROOT }];
      if (text.includes("homework_video_drive_roots")) return [{ tenant_id: TENANT }];
      return [];
    });
    const setting = await loadWorkerVideoDriveSetting(handled.sql, TENANT, { env: namedEnv });
    expect(setting).toEqual(shaped({ enabled: true, rootId: ROOT, source: "saved" }, "folders"));
    expect(handled.calls.filter((call) => call.text.includes("homework_video_drive_roots")).map((call) => call.text.includes("connection_id")))
      .toEqual([true, false]);
    expect(await workerVideoTargetMatches(handled.sql, TENANT, { rootId: ROOT, connectionId: null }, setting, { env: namedEnv })).toBe(true);
    expect(await workerVideoTargetMatches(handled.sql, TENANT, { rootId: ROOT, connectionId: "33333333-3333-4333-8333-333333333333" }, setting, { env: namedEnv })).toBe(false);
    const otherRoots = scripted((text) => {
      if (text.includes("homework_video_drive_settings")) return [{ enabled: true, root_folder_id: ROOT, connection_id: null }];
      return Object.assign(new Error('column "version" of homework_video_drive_roots does not exist'), { code: "42703" });
    });
    expect(await loadWorkerVideoDriveSetting(otherRoots.sql, TENANT, { env: namedEnv }))
      .toEqual(shaped({ enabled: false, rootId: null, source: "unknown", error: true }, "unknown"));
    await expect(workerVideoRootOwned(otherRoots.sql, TENANT, ROOT, { env: namedEnv })).rejects.toMatchObject({ code: "42703" });
  });

  it("설정 조회 실패는 불일치가 아니고, 확인된 연결 차이는 거절한다", async () => {
    const linked = "33333333-3333-4333-8333-333333333333";
    const other = "44444444-4444-4444-8444-444444444444";
    const unknown = { enabled: false, rootId: null, connectionId: null, source: "unknown", schema: "unknown", error: true };
    await expect(workerVideoTargetMatches(vi.fn(), TENANT, { rootId: ROOT, connectionId: linked }, unknown))
      .rejects.toThrow("영상 저장 폴더 설정을 확인하지 못했습니다.");
    await expect(workerVideoTargetMatches(vi.fn(), TENANT, { rootId: ROOT, connectionId: null }, { schema: "unknown" }))
      .rejects.toThrow("영상 저장 폴더 설정을 확인하지 못했습니다.");
    const owned = tables({
      settings: [{ enabled: true, root_folder_id: ROOT, connection_id: linked }],
      roots: [{ tenant_id: TENANT, connection_id: linked }],
      registry: [{ tenant_id: TENANT }],
    });
    const folders = { enabled: true, rootId: ROOT, connectionId: null, source: "saved", schema: "folders" };
    expect(await workerVideoTargetMatches(owned.sql, TENANT, { rootId: ROOT, connectionId: null }, folders)).toBe(true);
    expect(await workerVideoTargetMatches(owned.sql, TENANT, { rootId: ROOT, connectionId: linked }, folders)).toBe(false);
    const complete = { enabled: true, rootId: ROOT, connectionId: linked, source: "saved", schema: "complete" };
    expect(await workerVideoTargetMatches(owned.sql, TENANT, { rootId: ROOT, connectionId: other }, complete)).toBe(false);
    expect(await workerVideoTargetMatches(owned.sql, TENANT, { rootId: ROOT, connectionId: linked }, complete)).toBe(true);
    const foreign = tables({ roots: [{ tenant_id: OTHER, connection_id: linked }] });
    expect(await workerVideoTargetMatches(foreign.sql, TENANT, { rootId: ROOT, connectionId: linked }, complete)).toBe(false);
  });
});

describe("영상 큐는 env 폴더 없이 저장된 설정으로 켜진다", () => {
  it("저장된 설정이 켜져 있으면 env 폴더가 없어도 넣는다", async () => {
    delete process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID;
    const { sql, calls } = scripted((text) => {
      if (text.includes("homework_video_drive_roots")) return [{ tenant_id: TENANT }];
      if (text.includes("from homework_video_drive_settings")) return [{ enabled: true, root_folder_id: ROOT }];
      if (text.includes("insert into student_homework_videos")) return [{ inserted: true }];
      return [];
    });
    expect(await enqueueParentVideos(sql, TENANT, 10, [post])).toBe(1);
    expect(calls.some((call) => call.text.includes("insert into student_homework_videos"))).toBe(true);
  });

  it("해제 행이면 env 폴더가 있어도 넣지 않고, 넘긴 플래그는 조회보다 우선한다", async () => {
    process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = ENV_ROOT;
    const off = scripted((text) => text.includes("homework_video_drive_settings") ? [{ enabled: false, root_folder_id: ROOT }] : missing);
    expect(await enqueueParentVideos(off.sql, TENANT, 10, [post])).toBe(0);
    expect(off.calls.some((call) => call.text.includes("insert into"))).toBe(false);
    const forced = scripted((text) => {
      if (text.includes("homework_video_drive_settings")) return denied;
      if (text.includes("insert into student_homework_videos")) return [{ inserted: true }];
      return [];
    });
    expect(await enqueueParentVideos(forced.sql, TENANT, 10, [post], null, { enabled: true })).toBe(1);
    expect(forced.calls.some((call) => call.text.includes("homework_video_drive_settings"))).toBe(false);
    const unread = scripted(() => denied);
    await expect(enqueueParentVideos(unread.sql, TENANT, 10, [post])).rejects.toThrow("영상 저장 폴더 설정을 확인하지 못했습니다.");
    expect(unread.calls.some((call) => call.text.includes("insert into"))).toBe(false);
  });
});

describe("워커 배선", () => {
  it("기능 표식과 하트비트·피드는 env 폴더 게이트를 쓰지 않는다", () => {
    const read = (name) => readFileSync(path.join(process.cwd(), "scripts/_classnote", name), "utf8");
    const watch = read("watch-classnote-queue.mjs");
    const feed = read("classnote-feed-core.mjs");
    expect(watch).toContain("homeworkVideoTenantFolders: true");
    expect(watch).toContain("homeworkVideoTenantAccounts: true");
    expect(watch).toContain("videoArchiveHeartbeat(driveSetting)");
    expect(watch).toContain("driveSetting.error");
    expect(watch).not.toContain("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID");
    expect(feed).toContain("setting.error");
    expect(feed).not.toContain("videoArchiveEnabled(");
    expect(read("video-worker.mjs")).toContain("setting.error");
    expect(read("check-video-drive.mjs")).toContain("setting.error");
    expect(read("check-video-worker.mjs")).toContain("영상 저장 폴더 설정을 확인하지 못했습니다.");
  });
});
