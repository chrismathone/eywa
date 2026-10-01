import { describe, expect, it } from "vitest";
import { storeParentMessages } from "./classnote-inbox-store.mjs";
import { attachOnlyText, imageAttachments } from "./parent-comment-filter.mjs";

/** postgres.js 태그 템플릿을 흉내 낸다 — `sql(rows, ...cols)` 헬퍼 호출과 `sql\`...\`` 실행을 구분해 넘긴 행을 모은다. */
function fakeSql({ updateError = null } = {}) {
  const inserted = [];
  const updates = [];
  const sql = (first, ...rest) => {
    if (first && Array.isArray(first) && "raw" in first) {
      if (/insert into classnote_parent_message_attachments/.test(first.join("?"))) {
        updates.push(rest);
        return updateError ? Promise.reject(updateError) : Promise.resolve([]);
      }
      const helper = rest.find((v) => v && v.__rows);
      if (helper) inserted.push(...helper.__rows);
      return Promise.resolve((helper?.__rows ?? []).map((_, i) => ({ id: String(i) })));
    }
    return { __rows: first, __cols: rest };
  };
  sql.json = (v) => ({ __json: v });
  return { sql, inserted, updates };
}

const T = "tenant-1";
const map = new Map([[7, "stu-1"]]);

describe("학부모 연락 원문 저장 — 글자 없이 첨부만 있는 글·댓글(답글·공감 대상)", () => {
  it("글자가 있으면 종전 그대로 — 미분류(분류 큐에 걸린다)", async () => {
    const { sql, inserted } = fakeSql();
    const n = await storeParentMessages(sql, T, [{ source: "post", postId: 100, childId: 7, className: "(수학)홍", content: " 내일 결석합니다 ", postedAt: "2026-10-01T01:00:00Z" }], map);
    expect(n).toBe(1);
    expect(inserted[0]).toMatchObject({ content: "내일 결석합니다", classified_at: null, category: null, student_id: "stu-1" });
  });

  it("🔴 첨부만 있는 글은 대체 원문으로 저장하되 분류는 끝난 것으로 찍는다 — AI 분류 큐·출결 알림에 안 걸린다", async () => {
    const { sql, inserted } = fakeSql();
    const post = { id: 101, content: "", attached_video: { id: 5 } };
    const n = await storeParentMessages(sql, T, [{ source: "post", postId: 101, childId: 7, className: "(수학)홍", content: post.content, attachOnly: attachOnlyText(post), postedAt: "2026-10-01T02:00:00Z" }], map);
    expect(n).toBe(1);
    expect(inserted[0]).toMatchObject({ content: "[영상] (내용 없이 첨부만)", category: "none", classnote_post_id: 101, classnote_comment_id: null });
    expect(typeof inserted[0].classified_at).toBe("string"); // 'classified_at is null' 큐(분류)에서 빠진다
    expect(Number.isFinite(Date.parse(inserted[0].classified_at))).toBe(true);
    expect("notified_at" in inserted[0]).toBe(false); // 알림 경로(category <> 'none')는 category로 막힌다 — notified_at은 건드리지 않는다
  });

  it("첨부만 있는 댓글 — 댓글 번호와 함께 저장 · 글자도 첨부도 없는 빈 건은 저장하지 않는다", async () => {
    const { sql, inserted } = fakeSql();
    const c = { id: 55, content: "", attached_images: [{}, {}] };
    const n = await storeParentMessages(sql, T, [
      { source: "comment", postId: 100, commentId: 55, childId: 7, content: c.content, attachOnly: attachOnlyText(c) },
      { source: "comment", postId: 100, commentId: 56, childId: 7, content: "", attachOnly: attachOnlyText({ id: 56, content: "" }) },
    ], map);
    expect(n).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ source: "comment", classnote_comment_id: 55, content: "[사진 2장] (내용 없이 첨부만)", category: "none" });
  });

  it("호출부가 대체 원문 없이 빈 글을 넘겨도(옛 호출부) 저장하지 않는다", async () => {
    const { sql, inserted } = fakeSql();
    expect(await storeParentMessages(sql, T, [{ source: "post", postId: 9, childId: 7, content: "   " }], map)).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("사진 주소는 삽입과 따로 서버 전용 표에 붙인다(표가 없는 DB에서도 원문 저장은 그대로) · 표가 없으면(42P01) 이후 시도하지 않는다", async () => {
    const att = imageAttachments({ attached_images: [{ small: "https://up-kids-kage.kakao.com/dn/a/img_1x1.jpg", large: "https://up-kids-kage.kakao.com/dn/a/img_l.jpg", width: 800, height: 600 }] });
    const item = { source: "post", postId: 300, childId: 7, content: "숙제", attachments: att };
    const ok = fakeSql();
    expect(await storeParentMessages(ok.sql, T, [item], map)).toBe(1);
    expect(ok.inserted[0]).not.toHaveProperty("attachments"); // 원문 표에는 주소를 두지 않는다(직원 전원이 읽는 표)
    expect(ok.updates).toHaveLength(1);
    const missing = fakeSql({ updateError: Object.assign(new Error("relation does not exist"), { code: "42P01" }) });
    expect(await storeParentMessages(missing.sql, T, [item, { ...item, postId: 301 }], map)).toBe(2); // 원문은 저장됨
    expect(missing.updates).toHaveLength(1); // 첫 실패 뒤로는 시도하지 않는다
  });

  it("사진 주소 추출 — 업로드 CDN 호스트만, 작은 것·큰 것·크기, 이상한 주소는 버린다", () => {
    const good = { small: "https://up-kids-kage.kakao.com/dn/x/img_9x9.jpg", large: "https://up-kids-kage.kakao.com/dn/x/img_l.jpg", original: "https://up-kids-kage.kakao.com/dn/x/img.jpg", width: 1200, height: 900 };
    expect(imageAttachments({ attached_images: [good] })).toEqual([{ small: good.small, large: good.large, width: 1200, height: 900 }]);
    expect(imageAttachments({ attached_images: [{ large: "http://up-kids-kage.kakao.com/x.jpg" }, { large: "https://evil.example.com/x.jpg" }, { large: "javascript:alert(1)" }, null] })).toEqual([]);
    expect(imageAttachments({})).toEqual([]);
    expect(imageAttachments({ attached_images: Array.from({ length: 30 }, () => good) })).toHaveLength(10);
  });
});
