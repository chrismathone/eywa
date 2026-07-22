/**
 * notice-attachments.mjs 단위테스트 — 공지 첨부(교재요청서 PNG·교재 표지)의 준비 규칙.
 * page(Playwright) 의존은 전부 주입이라 브라우저 없이 검증한다.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createNoticeMediaUploader,
  fetchNoticeMedia,
  kageFilePayload,
  kageImagePayload,
  mediaForNoticeTarget,
  mimeForNoticeName,
  noticeEndpointFailureReason,
} from "./notice-attachments.mjs";

const img = (name, url) => ({ name, url });

describe("mimeForNoticeName", () => {
  it("확장자로 이미지 MIME을 고른다", () => {
    expect(mimeForNoticeName("표지.png")).toBe("image/png");
    expect(mimeForNoticeName("요청서.JPG")).toBe("image/jpeg");
    expect(mimeForNoticeName("a.jpeg")).toBe("image/jpeg");
    expect(mimeForNoticeName("a.webp")).toBe("image/webp");
    expect(mimeForNoticeName("a.gif")).toBe("image/gif");
  });
  it("파일(비이미지)은 octet-stream", () => {
    expect(mimeForNoticeName("안내.pdf", "file")).toBe("application/octet-stream");
  });
});

describe("noticeEndpointFailureReason", () => {
  it("상태별 한글 사유 — raw 코드가 아니라 조치가 보이는 문장", () => {
    expect(noticeEndpointFailureReason(401)).toContain("CLASSNOTE_INTERNAL_SECRET");
    expect(noticeEndpointFailureReason(404)).toContain("앱 미배포");
    expect(noticeEndpointFailureReason(-1)).toBe("네트워크 연결 실패");
    expect(noticeEndpointFailureReason(200)).toContain("서명 실패");
    expect(noticeEndpointFailureReason(503)).toBe("HTTP 503");
  });
});

describe("fetchNoticeMedia", () => {
  const call = (fetchImpl) => fetchNoticeMedia({ base: "https://app.example.com/", secret: "s3cr3t", noticeId: "n1", fetchImpl });

  it("정상 응답 — url 없는 항목은 목록에서 빠지되 expected/missing으로 **기록**된다(조용한 누락 금지)", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe("https://app.example.com/api/internal/notice-attachments/n1");
      expect(init.headers["x-eywa-internal"]).toBe("s3cr3t");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          common: { images: [img("표지.png", "u0")], files: [], expected: 1, missing: [] },
          targets: [
            {
              board: "(수학)홍길동",
              images: [img("표지.png", "u0"), img("요청서.png", "u1"), { name: "깨진" }],
              files: [],
              expected: 3,
              missing: ["깨진.png"],
            },
            { board: "(수학)김철수", images: [], files: [], expected: 0, missing: [] },
          ],
        }),
      };
    });
    const res = await call(fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.common.images).toHaveLength(1);
    expect(res.targets[0].images.map((i) => i.url)).toEqual(["u0", "u1"]);
    expect(res.targets[0].expected).toBe(3); // 서명 전 장수 — 준비 결과와 대조할 기준
    expect(res.targets[0].missing).toEqual(["깨진.png"]);
    expect(res.targets[1].images).toEqual([]);
  });

  it("구버전 앱(expected 없음)은 목록+missing 길이로 폴백한다", async () => {
    const res = await call(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ common: {}, targets: [{ board: "(수학)홍길동", images: [img("a.png", "u1")], files: [] }] }),
    }));
    expect(res.ok).toBe(true);
    expect(res.targets[0].expected).toBe(1);
  });

  it("DB엔 첨부가 있는데 전 타깃이 0장이면 실패 — 서명 전멸을 '첨부 없는 공지'로 오인하지 않는다", async () => {
    const res = await fetchNoticeMedia({
      base: "https://app.example.com",
      secret: "s3cr3t",
      noticeId: "n1",
      expectedTotal: 5,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          common: { images: [], files: [], expected: 0, missing: [] },
          targets: [
            { board: "(수학)홍길동", images: [], files: [], expected: 0, missing: [] },
            { board: "(수학)김철수", images: [], files: [], expected: 0, missing: [] },
          ],
        }),
      }),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("서명 실패");
  });

  it("401이면 한글 사유로 실패 — 워커가 게시를 멈춘다", async () => {
    const res = await call(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("CLASSNOTE_INTERNAL_SECRET");
    expect(res.targets).toEqual([]);
  });

  it("200인데 목록이 비면 실패로 본다(글자만 나가는 사고 방지)", async () => {
    const res = await call(async () => ({ ok: true, status: 200, json: async () => ({ common: {}, targets: [] }) }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("서명 실패");
  });

  it("네트워크 예외도 한글 문장으로", async () => {
    const res = await call(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("네트워크 연결 실패");
  });
});

describe("mediaForNoticeTarget", () => {
  const list = [
    { board: "(수학)홍길동", images: [img("a.png", "u1")], files: [] },
    { board: "(수학)김철수", images: [], files: [] },
  ];
  it("같은 순서(index)로 짝짓는다", () => {
    expect(mediaForNoticeTarget(list, { board: "(수학)김철수" }, 1)?.board).toBe("(수학)김철수");
  });
  it("순서가 어긋나면 보드명으로 찾는다", () => {
    expect(mediaForNoticeTarget(list, { board: "(수학)홍길동" }, 1)?.board).toBe("(수학)홍길동");
  });
  it("없으면 null — 첨부 빠진 게시를 막는다", () => {
    expect(mediaForNoticeTarget(list, { board: "(영어)박영희" }, 5)).toBeNull();
  });
});

describe("kage payload", () => {
  it("이미지 — kage가 준 크기 우선, 없으면 바이트 길이", () => {
    expect(kageImagePayload({ access_key: "k1", info: { img: { length: 10, width: 2, height: 3 } } }, { name: "a.png", byteLength: 99 })).toEqual({
      access_key: "k1",
      original_file_name: "a.png",
      file_size: 10,
      width: 2,
      height: 3,
    });
    expect(kageImagePayload({ access_key: "k1" }, { name: "a.png", byteLength: 99 }).file_size).toBe(99);
  });
  it("access_key 없으면 null(업로드 거부)", () => {
    expect(kageImagePayload({}, { name: "a.png", byteLength: 1 })).toBeNull();
    expect(kageFilePayload(null, { name: "a.pdf", byteLength: 1 })).toBeNull();
  });
  it("파일 — info.size 우선", () => {
    expect(kageFilePayload({ access_key: "k2", info: { size: 7 } }, { name: "a.pdf", byteLength: 99 }).file_size).toBe(7);
  });
});

describe("createNoticeMediaUploader", () => {
  const deps = () => {
    const openForm = vi.fn(async () => {});
    const upload = vi.fn(async (kind, file) => ({ access_key: `k-${file.name}`, info: { img: { length: 5, width: 1, height: 1 } } }));
    const download = vi.fn(async () => Buffer.from("bytes"));
    return { openForm, upload, download, log: () => {} };
  };

  it("타깃마다 작성폼을 1회만 연다(첨부 누적 방지)", async () => {
    const d = deps();
    const u = createNoticeMediaUploader(d);
    const out = await u.build({ images: [img("a.png", "u1"), img("b.png", "u2")], files: [] });
    expect(d.openForm).toHaveBeenCalledTimes(1);
    expect(out.attachedImages).toHaveLength(2);
    expect(out.failures).toEqual([]);
    expect(out.expected).toBe(2);
  });

  it("같은 첨부(공통 표지)는 타깃 간 재사용 — reused 표시", async () => {
    const d = deps();
    const u = createNoticeMediaUploader(d);
    await u.build({ images: [img("표지.png", "u0")], files: [] });
    const second = await u.build({ images: [img("표지.png", "u0"), img("요청서.png", "u9")], files: [] });
    expect(d.upload).toHaveBeenCalledTimes(2); // 표지 1회 + 요청서 1회
    expect(second.reused).toBe(true);
    expect(second.attachedImages).toHaveLength(2);
  });

  it("전부 캐시면 작성폼도 안 연다(불필요한 페이지 이동 방지)", async () => {
    const d = deps();
    const u = createNoticeMediaUploader(d);
    await u.build({ images: [img("표지.png", "u0")], files: [] });
    await u.build({ images: [img("표지.png", "u0")], files: [] });
    expect(d.openForm).toHaveBeenCalledTimes(1);
    expect(d.upload).toHaveBeenCalledTimes(1);
  });

  it("fresh=true면 캐시를 무시하고 다시 올린다(재사용 실패 폴백)", async () => {
    const d = deps();
    const u = createNoticeMediaUploader(d);
    await u.build({ images: [img("표지.png", "u0")], files: [] });
    const again = await u.build({ images: [img("표지.png", "u0")], files: [] }, { fresh: true });
    expect(d.upload).toHaveBeenCalledTimes(2);
    expect(again.reused).toBe(false);
  });

  it("다운로드 실패 — 단계가 보이는 한글 note", async () => {
    const d = deps();
    d.download = vi.fn(async () => {
      throw new Error("HTTP 403");
    });
    const out = await createNoticeMediaUploader(d).build({ images: [img("요청서.png", "u1")], files: [] });
    expect(out.attachedImages).toEqual([]);
    expect(out.failures[0]).toBe('"요청서.png" 다운로드 실패(HTTP 403)');
  });

  it("kage가 access_key를 안 주면 거부로 기록", async () => {
    const d = deps();
    d.upload = vi.fn(async () => ({}));
    const out = await createNoticeMediaUploader(d).build({ images: [img("요청서.png", "u1")], files: [] });
    expect(out.failures[0]).toContain("업로드 거부");
  });

  it("앱이 서명 못 한 첨부(missing)는 실패로 보고 — 게시가 보류된다", async () => {
    const d = deps();
    const out = await createNoticeMediaUploader(d).build({
      images: [img("표지.png", "u0")],
      files: [],
      expected: 2,
      missing: ["요청서.png"],
    });
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toContain("요청서.png");
    expect(out.expected).toBe(2);
  });

  it("설명되지 않은 개수 차이도 실패로 만든다(어디선가 조용히 빠진 경우)", async () => {
    const d = deps();
    const out = await createNoticeMediaUploader(d).build({
      images: [img("표지.png", "u0")],
      files: [],
      expected: 3, // 목록엔 1장뿐 + missing 표기도 없음 = 2장 증발
      missing: [],
    });
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toContain("2장");
  });

  it("expected와 준비 결과가 같으면 실패 없음", async () => {
    const d = deps();
    const out = await createNoticeMediaUploader(d).build({
      images: [img("a.png", "u1"), img("b.png", "u2")],
      files: [],
      expected: 2,
      missing: [],
    });
    expect(out.failures).toEqual([]);
    expect(out.attachedImages).toHaveLength(2);
  });

  it("파일 첨부는 doc 경로로 분리 전달", async () => {
    const d = deps();
    const out = await createNoticeMediaUploader(d).build({ images: [], files: [img("안내.pdf", "u5")] });
    expect(d.upload.mock.calls[0][0]).toBe("file");
    expect(d.upload.mock.calls[0][1].mimeType).toBe("application/octet-stream");
    expect(out.attachedFiles).toHaveLength(1);
    expect(out.attachedImages).toEqual([]);
  });
});
