import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseBoard } from "../classnote-release-list";
import type { SyncRun } from "../classnote-sync-report";

/** 동기화 보고서 내려받기(0329a) — 권한(강사 제외)·모듈 게이트·지점 격리·감사로그. */
const m = vi.hoisted(() => ({ user: vi.fn(), settings: vi.fn(), canWrite: vi.fn(), runs: vi.fn(), boards: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("./classnote-sync-report-core", () => ({ loadSyncRuns: m.runs, loadReleaseBoards: m.boards }));

import { downloadClassnoteSyncReport } from "./classnote-sync-report-actions";

const board = (p: Partial<ReleaseBoard>): ReleaseBoard =>
  ({ boardName: "중등M 중1", className: "중등M 중1", names: [], checkedAt: "2026-10-01T20:12:00Z", ...p });
const run = (p: Partial<SyncRun> = {}): SyncRun =>
  ({ kind: "daily", finishedAt: "2026-10-01T20:12:00Z", ok: true, error: null, truncated: false, counts: { changed: 1, failed: 0, held: 1 },
    events: [{ group: "changed", className: "중등M 중1", text: "원아 배정: 김민준" }, { group: "held", className: "중등M 중1", text: "박도윤: 학부모 미가입" }], ...p });

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "u1", tenantId: "t1", systemRole: "admin" });
  m.settings.mockResolvedValue({ modules: { disabled: [] }, profile: { name: "인재원" } });
  m.canWrite.mockResolvedValue(true);
  m.runs.mockResolvedValue({ latest: run(), lastDaily: null });
  m.boards.mockResolvedValue([board({ names: ["이서연", "최하린"] })]);
});

describe("동기화 보고서 내려받기", () => {
  it("글과 파일 이름을 돌려주고 감사로그를 남긴다 — 지점 id로 읽는다", async () => {
    const r = await downloadClassnoteSyncReport();
    expect(r).toMatchObject({ ok: true, filename: "ClassNote-동기화보고서-2026-10-02-0512.txt" });
    expect(r.ok && r.text).toContain("인재원 ClassNote 반 보드 동기화 보고서");
    expect(r.ok && r.text).toContain("  [중등M 중1] 원아 배정: 김민준");
    expect(r.ok && r.text).toContain("    - 이서연");
    expect(m.runs).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(m.boards).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(m.canWrite).toHaveBeenCalledWith("admin", "lesson_reports");
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "classnote_board_sync_report_export",
      metadata: expect.objectContaining({ changed: 1, failed: 0, held: 1, releaseNames: 2, releaseClasses: 1, ok: true }) }));
  });
  it("🔴 강사·권한 없음·ClassNote 기능이 꺼진 지점·비로그인은 거절 — 회차도 목록도 읽지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect((await downloadClassnoteSyncReport()).ok).toBe(false);
    m.canWrite.mockResolvedValue(true);
    m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, profile: {} });
    expect((await downloadClassnoteSyncReport()).ok).toBe(false);
    m.user.mockResolvedValue(null);
    expect((await downloadClassnoteSyncReport()).ok).toBe(false);
    expect(m.runs).not.toHaveBeenCalled();
    expect(m.boards).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });
  it("회차 기록이 없거나(동기화 전) 못 읽으면 한글 안내 — 영문 원문을 내보내지 않고 로그도 남기지 않는다", async () => {
    m.runs.mockResolvedValue({ latest: null, lastDaily: null });
    expect(await downloadClassnoteSyncReport()).toEqual({ ok: false, error: expect.stringContaining("아직 동기화 기록이 없습니다") });
    m.runs.mockRejectedValue(new Error('relation "classnote_board_sync_runs" does not exist'));
    const r = await downloadClassnoteSyncReport();
    expect(r).toEqual({ ok: false, error: expect.stringContaining("읽지 못했습니다") });
    expect(r.ok === false && r.error).not.toContain("classnote_board_sync_runs");
    expect(m.log).not.toHaveBeenCalled();
  });
});
