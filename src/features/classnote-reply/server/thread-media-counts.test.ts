import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: async () => null }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => false }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => null }));

import { countThreadMedia } from "./thread-media-counts";

const kakao = (n: string) => ({ small: `https://up-kids-kage.kakao.com/dn/${n}/s.jpg`, large: `https://up-kids-kage.kakao.com/dn/${n}/l.jpg` });
const admin = (videos: Record<string, unknown>[], photos: Record<string, unknown>[], seen: string[] = []) => ({
  from: (t: string) => {
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq"]) q[k] = () => q;
    q.in = async () => {
      seen.push(t);
      return { data: t === "student_homework_videos" ? videos : photos, error: null };
    };
    return q;
  },
}) as never;
const msg = (id: string, cid: number | null, studentId: string | null, childId: number | null = 7) =>
  ({ id, source: cid ? "comment" : "post", classnotePostId: 10, classnoteCommentId: cid, childId, studentId, boardName: "x", content: "c", postedAt: null }) as never;

describe("'학부모 글·답글' 면 첨부 개수 — 답글 창에 실제로 뜨는 것과 같은 판정", () => {
  it("영상 = 글/댓글 번호 + 학생 판정(videoBelongsToThread) · 사진 = 창과 같은 거르기(https·호스트·최대 10장)", async () => {
    const videos = [
      { post_id: 10, comment_id: null, student_id: "stu-A" },
      { post_id: 10, comment_id: null, student_id: "stu-B" }, // 다른 학생 — 창에 안 뜬다
      { post_id: 10, comment_id: null, student_id: null }, // 학생 미확정 — 원아를 아는 글이면 뜬다
      { post_id: 10, comment_id: 5, student_id: "stu-A" },
    ];
    const photos = [{ message_id: "p", attachments: [kakao("a"), { large: "https://evil.example.com/x.jpg" }, ...Array.from({ length: 12 }, (_, i) => kakao(`n${i}`))] }];
    const out = await countThreadMedia(admin(videos, photos), "t1", [msg("p", null, "stu-A"), msg("c", 5, "stu-A")]);
    expect(out.get("p")).toEqual({ videos: 2, photos: 10 });
    expect(out.get("c")).toEqual({ videos: 1, photos: 0 });
  });

  it("원문 행에 학생이 비어 있는 글(반 보드)은 학생을 모르므로 그 글 영상을 다 센다 · 원아를 모르는 글은 학생 미확정 영상을 안 센다", async () => {
    const videos = [{ post_id: 10, comment_id: null, student_id: "stu-B" }, { post_id: 10, comment_id: null, student_id: null }];
    expect((await countThreadMedia(admin(videos, []), "t1", [msg("p", null, null)])).get("p")?.videos).toBe(2);
    expect((await countThreadMedia(admin(videos, []), "t1", [msg("p", null, "stu-B", null)])).get("p")?.videos).toBe(1);
  });

  it("두 표가 없거나 읽기가 실패해도 면은 그대로(0) — #95", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { code: "42P01" } }) }) }) }) } as never;
    expect((await countThreadMedia(broken, "t1", [msg("p", null, "stu-A")])).size).toBe(0);
  });
});
