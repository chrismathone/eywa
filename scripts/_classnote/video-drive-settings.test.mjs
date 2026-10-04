import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueParentVideos } from "./video-inbox.mjs";
import { loadWorkerVideoDriveSetting, resolveVideoJobRoot, videoArchiveHeartbeat, workerVideoRootOwned } from "./video-drive-settings.mjs";

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

describe("워커 영상 저장 설정", () => {
  it("표가 없고 env 지점이 자기 지점이면 그 폴더만 레거시다", async () => {
    process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = "processEnvRoot1";
    process.env.CLASSNOTE_VIDEO_TENANT_ID = OTHER;
    const { sql, calls } = tables();
    const got = await loadWorkerVideoDriveSetting(sql, TENANT, { env: namedEnv });
    expect(got).toEqual({ enabled: true, rootId: ENV_ROOT, source: "legacy" });
    expect(calls.some((call) => call.text.includes("homework_video_drive_settings"))).toBe(true);
    expect(calls.some((call) => call.text.includes("classnote_video_folders"))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("processEnvRoot1");
  });

  it("CLASSNOTE_TENANT_ID 만 있으면 그 지점이 레거시 소유다", async () => {
    const { sql } = tables();
    const got = await loadWorkerVideoDriveSetting(sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_TENANT_ID: TENANT },
    });
    expect(got).toEqual({ enabled: true, rootId: ENV_ROOT, source: "legacy" });
  });

  it("다른 지점 env 는 레거시가 아니고, 영상 지점이 있으면 일반 지점 env 로 넓히지 않는다", async () => {
    const other = tables();
    expect(await loadWorkerVideoDriveSetting(other.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER },
    })).toEqual({ enabled: false, rootId: null, source: "none" });
    const namedWins = tables();
    expect(await loadWorkerVideoDriveSetting(namedWins.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER, CLASSNOTE_TENANT_ID: TENANT },
    })).toEqual({ enabled: false, rootId: null, source: "none" });
  });

  it("env 지점이 없으면 폴더 등록부의 유일한 소유자만 레거시다", async () => {
    const only = tables({ registry: [{ tenant_id: TENANT }] });
    expect(await loadWorkerVideoDriveSetting(only.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual({ enabled: true, rootId: ENV_ROOT, source: "legacy" });
    const shared = tables({ registry: [{ tenant_id: TENANT }, { tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(shared.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
    const foreign = tables({ registry: [{ tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(foreign.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
  });

  it("정상 스키마에 설정 행이 없으면 이 지점 소유 루트 행이 있을 때만 기존 env 연결을 유지한다", async () => {
    const absent = tables({ settings: [], roots: [], registry: [] });
    expect(await loadWorkerVideoDriveSetting(absent.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
    expect(absent.calls.some((call) => call.text.includes("homework_video_drive_settings"))).toBe(true);
    expect(absent.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(true);
    const seeded = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(seeded.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: true, rootId: ENV_ROOT, source: "legacy" });
    const uniqueOnly = tables({ settings: [], roots: [], registry: [{ tenant_id: TENANT }] });
    expect(await loadWorkerVideoDriveSetting(uniqueOnly.sql, TENANT, { env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT } }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
    const registryGone = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: missing });
    expect(await loadWorkerVideoDriveSetting(registryGone.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
    const namedElsewhere = tables({ settings: [], roots: [{ tenant_id: TENANT }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(namedElsewhere.sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: OTHER, CLASSNOTE_TENANT_ID: TENANT },
    })).toEqual({ enabled: false, rootId: null, source: "none" });
  });

  it("해제 행은 루트 표가 없어도 꺼진 채로 남고 env 로 돌아가지 않는다", async () => {
    const off = tables({
      settings: [{ enabled: false, root_folder_id: ROOT }],
      roots: missing,
    });
    expect(await loadWorkerVideoDriveSetting(off.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "saved" });
    expect(off.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(false);
    expect(off.calls.some((call) => call.text.includes("classnote_video_folders"))).toBe(false);
  });

  it("이름이 맞아도 루트 표나 등록부의 다른 지점 소유면 레거시를 거절한다", async () => {
    const rootsForeign = tables({ settings: [], roots: [{ tenant_id: OTHER }], registry: [] });
    expect(await loadWorkerVideoDriveSetting(rootsForeign.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
    const registryForeign = tables({ settings: [], roots: [], registry: [{ tenant_id: TENANT }, { tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(registryForeign.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "none" });
  });

  it("표 없음이 아닌 조회 오류는 꺼짐과 구분하고 env 로 가지 않는다", async () => {
    const { sql, calls } = scripted(() => denied);
    expect(await loadWorkerVideoDriveSetting(sql, TENANT, {
      env: { CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: ENV_ROOT, CLASSNOTE_VIDEO_TENANT_ID: TENANT },
    })).toEqual({ enabled: false, rootId: null, source: "unknown", error: true });
    expect(calls).toHaveLength(1);
    const legacyBroken = scripted((text) => text.includes("homework_video_drive_settings") ? missing : denied);
    expect(await loadWorkerVideoDriveSetting(legacyBroken.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "unknown", error: true });
  });

  it("켠 설정은 이 지점이 소유한 루트만 쓴다", async () => {
    const ok = tables({ settings: [{ enabled: true, root_folder_id: ROOT }], roots: [{ tenant_id: TENANT }] });
    expect(await loadWorkerVideoDriveSetting(ok.sql, TENANT, { env: {} })).toEqual({ enabled: true, rootId: ROOT, source: "saved" });
    const foreign = tables({ settings: [{ enabled: true, root_folder_id: ROOT }], roots: [{ tenant_id: OTHER }] });
    expect(await loadWorkerVideoDriveSetting(foreign.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "saved" });
    const empty = tables({ settings: [{ enabled: true, root_folder_id: null }] });
    expect(await loadWorkerVideoDriveSetting(empty.sql, TENANT, { env: {} })).toEqual({ enabled: false, rootId: null, source: "saved" });
    expect(empty.calls.some((call) => call.text.includes("homework_video_drive_roots"))).toBe(false);
    const rootsMissing = tables({ settings: [{ enabled: true, root_folder_id: ROOT }], roots: missing });
    expect(await loadWorkerVideoDriveSetting(rootsMissing.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "saved" });
    const rootsBroken = tables({ settings: [{ enabled: true, root_folder_id: ROOT }], roots: denied });
    expect(await loadWorkerVideoDriveSetting(rootsBroken.sql, TENANT, { env: namedEnv }))
      .toEqual({ enabled: false, rootId: null, source: "unknown", error: true });
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
    expect(resolveVideoJobRoot(active, null)).toEqual({ kind: "active", rootId: ROOT });
    expect(resolveVideoJobRoot(active, { rootId: "oldRoot1234567" }).kind).toBe("pinned");
    expect(resolveVideoJobRoot(off, { rootId: "oldRoot1234567" })).toEqual({ kind: "pinned", rootId: "oldRoot1234567" });
    expect(resolveVideoJobRoot(off, null)).toEqual({ kind: "skip", rootId: null });
  });

  it("하트비트 루트는 켜진 실제 설정만 담고 env 를 대신 적지 않는다", () => {
    expect(videoArchiveHeartbeat({ enabled: true, rootId: ROOT })).toEqual({ enabled: true, folderId: ROOT });
    expect(videoArchiveHeartbeat({ enabled: false, rootId: ROOT })).toEqual({ enabled: false, folderId: null });
    expect(videoArchiveHeartbeat({ enabled: false, rootId: null, source: "unknown", error: true })).toEqual({ enabled: false, folderId: null });
    expect(videoArchiveHeartbeat(null)).toEqual({ enabled: false, folderId: null });
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
