import { describe, expect, it } from "vitest";
// 워커 순수 모듈(.mjs · JSDoc 타입) — 워커 본체는 playwright/postgres를 물고 있어 순수 로직만 분리해 테스트.
import {
  buildNotificationText,
  countByEffectiveName,
  isParentPost,
  maxPostId,
  reachedWatermark,
  selectNewParentPosts,
} from "../../scripts/_classnote/parent-post-filter.mjs";

// 실측 피드 행 모양(2026-07-15, center 96575) 축약본.
function row(over: Record<string, unknown> = {}) {
  return {
    id: 1000,
    created: new Date().toISOString(),
    author: { id: 1, type: "parent", name: "박선민" },
    author_name: "박채원 엄마",
    class_name: "(수학)이시우",
    child_name: "이시우",
    content: "선생님 안녕하세요",
    attached_images: [],
    attached_files: [],
    attached_video: null,
    ...over,
  };
}

describe("isParentPost", () => {
  it("author.type이 parent인 글만 학부모 글", () => {
    expect(isParentPost(row())).toBe(true);
    expect(isParentPost(row({ author: { type: "teacher" } }))).toBe(false);
    expect(isParentPost(row({ author: { type: "admin" } }))).toBe(false); // 봇/기관 게시
    expect(isParentPost({})).toBe(false);
    expect(isParentPost(null)).toBe(false);
  });
});

describe("maxPostId", () => {
  it("가장 큰 id — 피드 순서와 무관", () => {
    expect(maxPostId([row({ id: 5 }), row({ id: 9 }), row({ id: 2 })])).toBe(9);
  });
  it("빈 피드는 null(워터마크 전진 안 함)", () => {
    expect(maxPostId([])).toBeNull();
    expect(maxPostId(undefined)).toBeNull();
  });
  it("id가 깨진 행은 무시", () => {
    expect(maxPostId([row({ id: "abc" }), row({ id: 3 })])).toBe(3);
  });
});

describe("reachedWatermark", () => {
  it("워터마크 이하 id가 페이지에 보이면 도달(더 과거로 안 감)", () => {
    expect(reachedWatermark([row({ id: 12 }), row({ id: 10 })], 10)).toBe(true);
    expect(reachedWatermark([row({ id: 12 }), row({ id: 11 })], 10)).toBe(false);
  });
  it("워터마크가 없으면(콜드 스타트) 즉시 도달로 취급 — 과거를 다 긁지 않는다", () => {
    expect(reachedWatermark([row({ id: 12 })], null)).toBe(true);
  });
});

describe("selectNewParentPosts", () => {
  const prefix = "(수학)";

  it("워터마크 초과 + 학부모 + 수학보드만 고른다", () => {
    const rows = [
      row({ id: 30, class_name: "(수학)이시우" }), // ✅
      row({ id: 29, class_name: "(영어)이시우" }), // ❌ 범위 밖 과목
      row({ id: 28, class_name: "[EIE] Let's Talk 2", author: { type: "parent" } }), // ❌ 그룹반
      row({ id: 27, author: { type: "teacher" } }), // ❌ 강사 글
      row({ id: 10, class_name: "(수학)김준영" }), // ❌ 워터마크 이하
    ];
    const { picked } = selectNewParentPosts(rows, { lastSeenId: 20, prefix });
    expect(picked.map((p: { id: number }) => p.id)).toEqual([30]);
  });

  it("id 오름차순(오래된 것 먼저)으로 돌려준다 — 알림이 시간순으로 쌓이도록", () => {
    const rows = [row({ id: 33 }), row({ id: 31 }), row({ id: 32 })];
    const { picked } = selectNewParentPosts(rows, { lastSeenId: 30, prefix });
    expect(picked.map((p: { id: number }) => p.id)).toEqual([31, 32, 33]);
  });

  it("워터마크가 null이면 전부 후보(콜드 스타트 처리는 호출부 책임)", () => {
    const { picked } = selectNewParentPosts([row({ id: 1 })], { lastSeenId: null, prefix });
    expect(picked).toHaveLength(1);
  });

  it("age 가드 — 오래된 글은 tooOld로 분리(PC가 꺼졌다 켜져도 밀린 알림 폭주 없음)", () => {
    const nowMs = Date.parse("2026-07-15T00:00:00Z");
    const rows = [
      row({ id: 41, created: "2026-07-14T23:00:00Z" }), // 1시간 전 ✅
      row({ id: 42, created: "2026-07-01T00:00:00Z" }), // 14일 전 → tooOld
    ];
    const { picked, tooOld } = selectNewParentPosts(rows, { lastSeenId: 40, prefix, nowMs, maxAgeDays: 3 });
    expect(picked.map((p: { id: number }) => p.id)).toEqual([41]);
    expect(tooOld.map((p: { id: number }) => p.id)).toEqual([42]);
  });

  it("created가 깨져도 버리지 않는다 — 순서·판정의 진실은 id", () => {
    const { picked } = selectNewParentPosts([row({ id: 50, created: "" })], { lastSeenId: 40, prefix });
    expect(picked.map((p: { id: number }) => p.id)).toEqual([50]);
  });
});

// 워커의 norm(공백 제거)과 동형 — 순수 모듈이 정규화를 주입받으므로 테스트도 같은 규칙을 넘긴다.
const norm = (s: string) => s.replace(/\s+/g, "");

describe("countByEffectiveName — 동명이인 보류 판정 (실제 오배달 사고를 낸 규칙)", () => {
  it("classnote_name이 있으면 그게 유효이름, 없으면 name", () => {
    const c = countByEffectiveName(
      [{ name: "박서준", classnote_name: "박서준C" }, { name: "이시우", classnote_name: null }],
      norm,
    );
    expect(c.get("박서준C")).toBe(1);
    expect(c.get("이시우")).toBe(1);
    expect(c.has("박서준")).toBe(false); // 오버라이드가 원본을 대체
  });

  it("⭐ 완전히 같은 이름 2명을 **접지 않고 센다** — Set으로 접으면 F1(퇴원 동명) 구멍이 열린다", () => {
    // 실제 사례: 재원 김채은(고1) + 퇴원 김채은(중1). 보드 (수학)김채은은 퇴원 가족이 쓰고 있었다.
    const c = countByEffectiveName(
      [
        { name: "김채은", classnote_name: null }, // 재원
        { name: "김채은", classnote_name: null }, // 퇴원 — 우주에 반드시 포함돼야 함
        { name: "이시우", classnote_name: null },
      ],
      norm,
    );
    expect(c.get("김채은")).toBe(2); // 2 → 호출부가 보류
    expect(c.get("이시우")).toBe(1); // 1 → 정상 알림
  });

  it("공백 차이는 같은 이름으로 센다(norm 주입)", () => {
    const c = countByEffectiveName([{ name: "김 민수" }, { name: "김민수" }], norm);
    expect(c.get("김민수")).toBe(2);
  });

  it("빈 이름·공백뿐인 이름은 세지 않는다", () => {
    const c = countByEffectiveName([{ name: "" }, { name: "   " }, { name: null }, {}], norm);
    expect(c.size).toBe(0);
  });

  it("빈 입력에 안전", () => {
    expect(countByEffectiveName([], norm).size).toBe(0);
    expect(countByEffectiveName(undefined, norm).size).toBe(0);
  });
});

describe("buildNotificationText", () => {
  it("제목=학생 이름, 본문=학부모 글 본문(강사가 벨에서 바로 읽는다)", () => {
    const { title, body } = buildNotificationText(
      row({ content: "시우가 오늘 감기때문에\n학원 하루 쉬겠습니다" }),
      "이시우",
    );
    expect(title).toBe("이시우 학부모 글");
    expect(body).toBe("시우가 오늘 감기때문에 학원 하루 쉬겠습니다"); // 줄바꿈 → 공백
  });

  it("첨부가 있으면 앞에 표시", () => {
    const { body } = buildNotificationText(
      row({ content: "숙제 사진입니다", attached_images: [{}, {}] }),
      "이현지",
    );
    expect(body).toBe("[사진 2장] 숙제 사진입니다");
  });

  it("내용 없이 첨부만 올린 글도 왜 알림이 왔는지 알려준다", () => {
    const { body } = buildNotificationText(row({ content: "", attached_images: [{}] }), "박서연E");
    expect(body).toBe("[사진 1장] (내용 없이 첨부만)");
  });

  it("내용도 첨부도 없으면 최소 문구", () => {
    expect(buildNotificationText(row({ content: "  " }), "김준영").body).toBe("학부모님이 새 글을 남겼습니다");
  });

  it("아주 긴 글은 200자에서 자른다(벨이 본문을 안 자르고 렌더하므로)", () => {
    const { body } = buildNotificationText(row({ content: "가".repeat(500) }), "이시우");
    expect(body).toHaveLength(201); // 200 + "…"
    expect(body.endsWith("…")).toBe(true);
  });
});
