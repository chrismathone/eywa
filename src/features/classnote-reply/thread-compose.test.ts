import { describe, expect, it } from "vitest";
import type { ReplyView, ThreadPhoto, ThreadVideo } from "./reply-types";
import { composeThread, type ThreadMessage } from "./thread-compose";
import { hasVideoMarker, markerPhotoCount, MEDIA_LOCKED_TEXT, PHOTO_NOT_LISTED_TEXT, toThreadVideo, VIDEO_NOT_LISTED_TEXT, VIDEO_PENDING_TEXT } from "./thread-video";

const reply = (id: string, createdAt: string): ReplyView => ({
  id, authorLabel: "BS3Q 수진T", body: `답글 ${id}`, pendingBody: null, statusLabel: "올림", tone: "positive", busy: false, error: null, errorRaw: null,
  canChange: true, notPosted: false, mine: true, createdAt, editedAt: null, historyCount: 0,
});
const msg = (id: string, source: "post" | "comment", postedAt: string, content = "내용", cid: number | null = null): ThreadMessage => ({ id, source, classnoteCommentId: cid, content, postedAt });

describe("쓰레드 조립 — 학부모 글·댓글과 우리 답글을 시간순 한 줄기로", () => {
  it("시간순이고, 같은 시각이면 학부모 글이 먼저이며, 지금 답글 대상 글에 focus 표시가 선다", () => {
    const out = composeThread({
      focusId: "c1",
      messages: [msg("p", "post", "2026-10-01T01:00:00Z"), msg("c1", "comment", "2026-10-01T03:00:00Z", "댓글", 5)],
      replies: [{ view: reply("r1", "2026-10-01T02:00:00Z"), messageId: "p" }, { view: reply("r2", "2026-10-01T03:00:00Z"), messageId: "c1" }],
      videosOf: () => [],
      photosOf: () => [],
      canWatch: true,
    });
    expect(out.map((e) => (e.kind === "parent" ? e.messageId : e.reply.id))).toEqual(["p", "r1", "c1", "r2"]);
    expect(out.filter((e) => e.kind === "parent" && e.focus).map((e) => (e as { messageId: string }).messageId)).toEqual(["c1"]);
  });

  it("삭제된 답글도 상태 라벨과 함께 그대로 줄기에 남는다(수정·삭제 권한 규칙은 ReplyView가 이미 담고 있다)", () => {
    const gone = { ...reply("r9", "2026-10-01T05:00:00Z"), statusLabel: "삭제됨", canChange: false };
    const out = composeThread({ focusId: "p", messages: [msg("p", "post", "2026-10-01T01:00:00Z")], replies: [{ view: gone, messageId: "p" }], videosOf: () => [], photosOf: () => [], canWatch: true });
    expect(out[1]).toMatchObject({ kind: "reply", reply: { statusLabel: "삭제됨", canChange: false } });
  });

  it("영상 표시가 있는데 보관 행이 없으면 안내 문구 — 권한이 없으면 권한 문구, 영상 줄은 만들지 않는다", () => {
    const m = msg("p", "post", "2026-10-01T01:00:00Z", "[영상] (내용 없이 첨부만)");
    const base = { focusId: "p", messages: [m], replies: [], videosOf: () => [] as ThreadVideo[], photosOf: () => [] as ThreadPhoto[] };
    expect(composeThread({ ...base, canWatch: true })[0]).toMatchObject({ videos: [], photos: [], mediaNote: VIDEO_NOT_LISTED_TEXT });
    expect(composeThread({ ...base, canWatch: false })[0]).toMatchObject({ videos: [], photos: [], mediaNote: MEDIA_LOCKED_TEXT });
    // 영상·사진 표시가 없는 글엔 안내도 없다.
    expect(composeThread({ ...base, messages: [msg("p", "post", "2026-10-01T01:00:00Z", "숙제 했어요")], canWatch: true })[0]).toMatchObject({ mediaNote: null });
    // 사진 표시는 있는데 주소가 없으면(이 기능 전의 글) 사진 안내 — 주소가 있으면 안내 없이 사진이 붙는다.
    const ph = msg("c", "comment", "2026-10-01T01:00:00Z", "[사진 2장] (내용 없이 첨부만)", 7);
    expect(composeThread({ ...base, messages: [ph], focusId: "c", canWatch: true })[0]).toMatchObject({ mediaNote: PHOTO_NOT_LISTED_TEXT });
    const photo = { small: "https://x/s.jpg", large: "https://x/l.jpg", width: 10, height: 10 };
    expect(composeThread({ ...base, messages: [ph], focusId: "c", photosOf: () => [photo, photo], canWatch: true })[0]).toMatchObject({ photos: [photo, photo], mediaNote: null });
    expect(composeThread({ ...base, messages: [ph], focusId: "c", canWatch: false })[0]).toMatchObject({ mediaNote: MEDIA_LOCKED_TEXT });
  });
});

describe("영상 화면 모델 — 상태별 한글 문구와 주소 노출", () => {
  const row = (status: string, fileId: string | null = "1AbCdEfGhIjKlMn") => ({ id: "v", status, drive_file_id: fileId, uploaded_at: "2026-10-01T00:00:00Z" });
  it("보관 완료 = 재생 가능(주소 포함) · Drive 열기는 관리자뷰에서만", () => {
    const admin = toThreadVideo(row("uploaded"), { canView: true, showDriveLink: true });
    expect(admin).toMatchObject({ playable: true, pending: false });
    expect(admin.links?.preview).toContain("/preview");
    expect(admin.links?.view).toContain("/view");
    expect(toThreadVideo(row("uploaded"), { canView: true, showDriveLink: false }).links?.view).toBeNull();
  });
  it("수집·업로드 중·재시도 = 보관 중 안내(다시 확인 대상) · 확인 필요 = 폴링 안 함 · 주소는 없다", () => {
    for (const s of ["queued", "processing"]) expect(toThreadVideo(row(s), { canView: true, showDriveLink: false })).toMatchObject({ playable: false, pending: true, label: VIDEO_PENDING_TEXT, links: null });
    expect(toThreadVideo(row("failed"), { canView: true, showDriveLink: false })).toMatchObject({ playable: false, pending: true, links: null });
    expect(toThreadVideo(row("review"), { canView: true, showDriveLink: false })).toMatchObject({ playable: false, pending: false, links: null });
    // 보관 완료인데 파일 주소가 이상하면 재생을 열지 않고 다시 확인한다.
    expect(toThreadVideo(row("uploaded", "x"), { canView: true, showDriveLink: false })).toMatchObject({ playable: false, pending: true, links: null });
  });
  it("🔴 열람 게이트를 못 넘으면 상태와 무관하게 주소를 싣지 않는다", () => {
    const v = toThreadVideo(row("uploaded"), { canView: false, showDriveLink: true });
    expect(v).toMatchObject({ playable: false, pending: false, links: null });
    expect(JSON.stringify(v)).not.toContain("drive.google.com");
    expect(JSON.stringify(v)).not.toContain("1AbCdEfGhIjKlMn");
  });
  it("영상 표시 판정", () => {
    expect(hasVideoMarker("[영상] (내용 없이 첨부만)")).toBe(true);
    expect(hasVideoMarker("[사진 1장·영상] (내용 없이 첨부만)")).toBe(true);
    expect(hasVideoMarker("[사진 1장] (내용 없이 첨부만)")).toBe(false);
    expect(hasVideoMarker("영상 올렸어요")).toBe(false);
    expect(markerPhotoCount("[사진 2장·영상] (내용 없이 첨부만)")).toBe(2);
    expect(markerPhotoCount("[영상] (내용 없이 첨부만)")).toBe(0);
    expect(markerPhotoCount("사진 3장 보냅니다")).toBe(0);
  });
});
