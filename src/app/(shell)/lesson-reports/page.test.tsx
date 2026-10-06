import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Face } from "@/components/face-tabs";

const m = vi.hoisted(() => ({ settings: vi.fn(), access: vi.fn(), write: vi.fn(), require: vi.fn(), queue: vi.fn(), writing: vi.fn(), boards: vi.fn(), notices: vi.fn(), wide: vi.fn(), noticeOptions: vi.fn(), threads: vi.fn(), students: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: m.require }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.access, canWriteTenant: m.write }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/report-admin/server/queries", () => ({ getClassnoteQueue: m.queue, getWeeklyWritingRates: m.writing, getReportFilterOptions: async () => ({}), getReportTeacherCandidates: async () => ({ bySubject: {}, staffNames: [] }) }));
vi.mock("@/features/report-admin/server/board-roster-queries", () => ({ getBoardRosterCheck: m.boards }));
vi.mock("@/features/report-admin/server/notice-actions", () => ({ getNoticeClassOptions: m.noticeOptions, listClassNotices: m.notices }));
vi.mock("@/features/report-admin/server/class-notice-actions", () => ({ listClassWideNotices: m.wide }));
vi.mock("@/features/report-admin/server/actions", () => ({ listReports: async () => ({ rows: [], total: 0 }) }));
vi.mock("@/features/classnote-reply/server/reply-queries", () => ({ listParentThreads: m.threads }));
vi.mock("@/features/students/server/queries", () => ({ getStudentsList: m.students }));
vi.mock("@/features/onescreen/server/prompt-actions", () => ({ getActivePrompts: async () => ({ prompts: [] }) }));
vi.mock("@/features/onescreen/server/ment-style-actions", () => ({ getMentStyleRows: async () => [] }));
vi.mock("@/features/video-homework/server/queries", () => ({ getVideoHomeworkClassOptions: async () => [] }));
vi.mock("@/features/owner/components/setting-roles-control", () => ({ SettingRolesControl: () => null }));
vi.mock("@/components/page-header", () => ({ PageHeader: () => <h1>수업보고서</h1> }));
vi.mock("@/components/face-tabs", () => ({ FaceTabs: ({ faces, active, ariaLabel }: { faces: Face[]; active: string; ariaLabel: string }) => <nav aria-label={ariaLabel}>{faces.map(f => <a key={f.key} href={f.href} aria-current={f.key === active ? "page" : undefined}>{f.label}</a>)}</nav> }));
vi.mock("./_components/classnote-queue-card", () => ({ ClassnoteQueueCard: () => <div>큐 본문</div> }));
vi.mock("./_components/writing-rate-card", () => ({ WritingRateCard: () => <div>작성률 본문</div> }));
vi.mock("./_components/board-roster-card", () => ({ BoardRosterCard: () => <div>반 구성 본문</div> }));
vi.mock("./_components/report-list", () => ({ ReportList: () => <div>목록 본문</div> }));
vi.mock("./_components/recall-face", () => ({ RecallFace: () => <div>회수 본문</div> }));
vi.mock("./_components/parent-replies-face", () => ({ ParentRepliesFace: () => <div>답글 본문</div> }));
vi.mock("./_components/compose-tab", () => ({ ComposeTab: () => <div>직접 발송 본문</div> }));
vi.mock("./_components/notice-face", () => ({ NoticeFace: () => <div>공지 본문</div> }));
vi.mock("@/app/(shell)/owner/_components/report-section", () => ({ ReportSection: () => <div>보고서 설정 본문</div> }));
vi.mock("@/app/(shell)/owner/_components/ai-ment-section", () => ({ AiMentSection: () => <div>AI 본문</div> }));

import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  m.require.mockResolvedValue({ id: "synthetic-admin", tenantId: "synthetic-branch", systemRole: "admin" });
  m.access.mockResolvedValue(true); m.write.mockResolvedValue(true);
  m.settings.mockResolvedValue({ modules: { disabled: [] }, report: { classnoteParentReplyMode: "on", classnoteSendEnabled: true } });
  m.queue.mockResolvedValue({}); m.writing.mockResolvedValue({}); m.boards.mockResolvedValue({});
  m.noticeOptions.mockResolvedValue({ classes: [] }); m.notices.mockResolvedValue({ rows: [] }); m.wide.mockResolvedValue({ rows: [] });
  m.threads.mockResolvedValue({}); m.students.mockResolvedValue([]);
});
afterEach(cleanup);
const show = async (sp: Record<string, string | undefined> = {}) => render(await Page({ searchParams: Promise.resolve(sp) }));
const businessReads = () => [m.queue, m.boards, m.noticeOptions, m.notices, m.wide, m.threads, m.students];

describe("수업보고서 실제 서버 페이지의 선택·조회·상위/하위 탭", () => {
  it("상위 클래스노트를 열면 큐만 읽고 두 단계의 현재 위치를 표시한다", async () => {
    await show({ tab: "classnote" });
    expect(m.queue).toHaveBeenCalledOnce();
    expect(m.writing).not.toHaveBeenCalled();
    for (const fn of businessReads().slice(1)) expect(fn).not.toHaveBeenCalled();
    expect(within(screen.getByRole("navigation", { name: "수업보고서 면" })).getByRole("link", { name: "클래스노트" })).toHaveAttribute("aria-current", "page");
    const child = within(screen.getByRole("navigation", { name: "클래스노트 기능" }));
    expect(child.getByRole("link", { name: "발송 큐" })).toHaveAttribute("aria-current", "page");
    expect(child.getAllByRole("link")).toHaveLength(6);
  });
  it.each(["queue", "boards", "notice", "compose", "recall", "parent_replies"])("모듈 끔: 새·기존 %s 주소 모두 관련 데이터를 읽지 않는다", async section => {
    m.settings.mockResolvedValue({ modules: { disabled: ["classnote"] }, report: { classnoteParentReplyMode: "on", classnoteSendEnabled: true } });
    await show({ tab: "classnote", section });
    expect(screen.queryByRole("link", { name: "클래스노트" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "클래스노트 기능" })).toBeNull();
    expect(m.writing).toHaveBeenCalledOnce();
    for (const fn of businessReads()) expect(fn).not.toHaveBeenCalled();
    cleanup(); vi.clearAllMocks();
    await show({ tab: section });
    for (const fn of businessReads()) expect(fn).not.toHaveBeenCalled();
  });
  it("기존 답글 딥링크와 새 링크는 페이지2 조회·상위 선택이 같다", async () => {
    for (const params of [{ tab: "parent_replies", page: "2" }, { tab: "classnote", section: "parent_replies", page: "2" }]) {
      await show(params);
      expect(m.threads).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "on", page: "2" }));
      expect(screen.getByText("답글 본문")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "클래스노트" })).toHaveAttribute("aria-current", "page");
      cleanup();
    }
  });
  it("답글 끔·쓰기 권한 없음은 조회까지 차단한다", async () => {
    m.settings.mockResolvedValue({ modules: { disabled: [] }, report: { classnoteParentReplyMode: "off" } });
    await show({ tab: "classnote", section: "parent_replies" });
    expect(m.threads).not.toHaveBeenCalled();
    cleanup(); m.write.mockResolvedValue(false);
    await show({ tab: "classnote", section: "compose" });
    expect(m.students).not.toHaveBeenCalled();
  });
});
