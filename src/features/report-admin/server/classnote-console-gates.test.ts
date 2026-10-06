import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), settings: vi.fn(), canWrite: vi.fn(), client: vi.fn(), admin: vi.fn(), readonly: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: async () => true }));
vi.mock("@/lib/auth/view-mode", () => ({ readonlyTeacherViewError: m.readonly, effectiveTeacherId: async () => null }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { linkClassnoteChild, unlinkClassnoteChild } from "./board-roster-actions";
import { getBoardRosterCheck } from "./board-roster-queries";
import { getClassnoteQueue } from "./queries";
import { requestReportRecall, requestReportRecallByShareToken } from "./recall-actions";
import { getNoticeClassOptions, listClassNotices, previewClassNotice, sendClassNotice } from "./notice-actions";
import { listClassWideNotices, loadMyClassWideNotice, sendClassWideNotice } from "./class-notice-actions";
import { cancelOnescreenNotice, editPostedNotice, editQueuedNotice, deleteQueuedNotice } from "@/features/onescreen/server/notice-actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: "synthetic-admin", tenantId: "synthetic-branch", systemRole: "admin" });
  // 옛 발송·답글 스위치가 켜져 있어도 최상위 모듈이 끔이면 데이터와 작업은 모두 닫힌다.
  m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, report: { classnoteSendEnabled: true, classnoteParentReplyMode: "on" } });
  m.canWrite.mockResolvedValue(true);
  m.readonly.mockResolvedValue(null);
  m.client.mockImplementation(() => { throw new Error("Disabled module must not reach business data"); });
  m.admin.mockImplementation(() => { throw new Error("Disabled module must not reach business data"); });
});

const pin = { studentId: "student", boardId: 1, childId: 2 };
const notice = { classIds: ["class"], body: "합성 공지", test: true };
const blocked = { ok: false, error: "사용할 수 없는 기능입니다" };

describe("클래스노트 모듈 끔 — 오래 열린 화면·직접 서버 호출도 차단", () => {
  it.each([
    ["반 연결", () => linkClassnoteChild(pin)],
    ["반 연결 해제", () => unlinkClassnoteChild(pin)],
    ["회수 id", () => requestReportRecall(["report"])],
    ["회수 공유 토큰", () => requestReportRecallByShareToken("share-token")],
    ["공지 반 선택", () => getNoticeClassOptions()],
    ["원생 개별 공지 이력", () => listClassNotices()],
    ["원생 개별 공지 미리보기", () => previewClassNotice(notice)],
    ["원생 개별 공지 발송", () => sendClassNotice(notice)],
    ["반 단체 공지 발송", () => sendClassWideNotice({ ...notice, title: "합성 제목" })],
    ["반 단체 공지 이력", () => listClassWideNotices()],
    ["강사 반 단체 공지", () => loadMyClassWideNotice()],
    ["게시된 공지 회수", () => cancelOnescreenNotice("notice")],
    ["게시된 공지 수정", () => editPostedNotice("notice", "수정")],
    ["대기 공지 수정", () => editQueuedNotice("notice", "수정")],
    ["대기 공지 삭제", () => deleteQueuedNotice("notice")],
  ] as const)("%s가 DB 조회·수정·감사 로그 전에 중단된다", async (_name, call) => {
    expect(await call()).toEqual(blocked);
    expect(m.client).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });

  it.each([["발송 큐", getClassnoteQueue], ["반 구성", getBoardRosterCheck]] as const)("%s 읽기도 업무 데이터 조회 전에 중단된다", async (_name, call) => {
    expect(await call()).toBeNull();
    expect(m.client).not.toHaveBeenCalled();
    expect(m.admin).not.toHaveBeenCalled();
  });
});

it("다시 켜면 기존 입력·쓰기 권한 판정으로 돌아간다", async () => {
  m.settings.mockResolvedValue({ modules: { disabled: [] }, report: { classnoteSendEnabled: false } });
  expect(await linkClassnoteChild({ ...pin, studentId: "" })).toMatchObject({ ok: false, error: "요청 값이 올바르지 않습니다" });
  expect(await requestReportRecall([])).toMatchObject({ ok: false, error: "대상이 없습니다" });
  m.canWrite.mockResolvedValue(false);
  expect(await unlinkClassnoteChild(pin)).toMatchObject({ ok: false, error: "해제할 권한이 없습니다" });
  expect(m.client).not.toHaveBeenCalled();
});
