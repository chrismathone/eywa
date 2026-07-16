import { describe, expect, it } from "vitest";
// 워커 순수 모듈(.mjs · JSDoc 타입) — 워커 본체는 playwright/postgres를 물고 있어 순수 로직만 분리해 테스트.
import {
  buildCommentNotificationText,
  pruneCounts,
  selectChangedReports,
  selectNewComments,
} from "../../scripts/_classnote/parent-comment-filter.mjs";

/** 실측 피드 행(2026-07-16, center 96575) 축약본 — 댓글 감지는 `num_comments`만 본다. */
function row(over: Record<string, unknown> = {}) {
  return { id: 1000, class_name: "(수학)이시우", num_comments: 0, ...over };
}

/** 실측 댓글(2026-07-16) 축약본. */
function cm(over: Record<string, unknown> = {}) {
  return {
    id: 776104209,
    created: new Date().toISOString(),
    author: { id: 5, type: "parent", name: "이현지" },
    author_name: "이상윤 엄마",
    content: "선생님 오늘 결석입니다",
    emoticon_content: null,
    attached_images: [],
    attached_files: [],
    attached_video: null,
    ...over,
  };
}

describe("selectChangedReports", () => {
  it("처음 보는 글은 기준선만 잡고 절대 알리지 않는다(콜드 스타트 방어)", () => {
    // 창 안 글의 기존 댓글은 우리가 켜지기 전 것 — 첫 실행에 수백 건이 벨에 쏟아지면 안 된다.
    const r = selectChangedReports([row({ id: 10, num_comments: 3 }), row({ id: 11, num_comments: 0 })], {}, { prefix: "(수학)" });
    expect(r.changed).toEqual([]);
    expect(r.firstSeen).toBe(2);
    expect(r.nextCounts).toEqual({ "10": 3, "11": 0 }); // 기준선은 기록
  });

  it("댓글 수가 변한 글만 골라낸다", () => {
    const counts = { "10": 3, "11": 0, "12": 5 };
    const r = selectChangedReports(
      [row({ id: 10, num_comments: 4 }), row({ id: 11, num_comments: 0 }), row({ id: 12, num_comments: 5 })],
      counts,
      { prefix: "(수학)" },
    );
    expect(r.changed).toEqual([{ id: 10, className: "(수학)이시우", knownCount: 3, count: 4 }]);
    expect(r.firstSeen).toBe(0);
  });

  it("댓글이 **줄어든** 경우도 변화로 잡는다(삭제 → 기준선 재동기화)", () => {
    // 안 잡으면 known이 실제보다 크게 남아, 이후 새 댓글이 slice에 먹혀 영영 샌다.
    const r = selectChangedReports([row({ id: 10, num_comments: 2 })], { "10": 3 }, { prefix: "(수학)" });
    expect(r.changed).toEqual([{ id: 10, className: "(수학)이시우", knownCount: 3, count: 2 }]);
  });

  it("대상 보드(prefix) 밖은 창에서 통째로 제외 — 영어·그룹 보드는 범위 밖", () => {
    const r = selectChangedReports(
      [row({ id: 10, class_name: "(영어)이시우", num_comments: 9 }), row({ id: 11, class_name: "Jane 중1 SKY (화수금)", num_comments: 9 })],
      {},
      { prefix: "(수학)" },
    );
    expect(r.nextCounts).toEqual({}); // 스냅샷에도 안 남는다
    expect(r.firstSeen).toBe(0);
  });

  it("nextCounts는 창 안 전 글의 **현재** 수 — 변한 글 포함(호출부가 실패 시에만 되돌린다)", () => {
    const r = selectChangedReports([row({ id: 10, num_comments: 4 })], { "10": 3 }, { prefix: "(수학)" });
    expect(r.nextCounts["10"]).toBe(4);
  });

  it("id·num_comments가 깨진 행은 무시(피드 필드 누락에도 안 죽음)", () => {
    // 의도적으로 잘못된 행 — 피드가 필드를 빠뜨려도 안 죽는지 확인(타입 밖 입력이라 any).
    const bad = [{ id: "x" }, { class_name: "(수학)이시우" }, null] as unknown as Parameters<typeof selectChangedReports>[0];
    const r = selectChangedReports(bad, {}, { prefix: "(수학)" });
    expect(r.nextCounts).toEqual({});
    expect(r.changed).toEqual([]);
  });
});

describe("selectNewComments", () => {
  it("⚠️ API는 id **내림차순**(최신 먼저)으로 준다 — asc로 다시 정렬해 앞의 known개를 건너뛴다", () => {
    // 이 테스트가 회귀 트립와이어다: 정렬을 빼면 "최신 것을 이미 아는 것"으로 착각해 새 댓글을 놓친다.
    const list = [cm({ id: 300, content: "새 댓글" }), cm({ id: 200 }), cm({ id: 100 })]; // 실제 응답 순서
    const r = selectNewComments(list, { knownCount: 2, actualCount: 3 });
    expect(r.incomplete).toBe(false);
    expect(r.picked.map((k) => k.id)).toEqual([300]);
  });

  it("강사 답글은 num_comments를 올리지만 알리지 않는다", () => {
    const list = [cm({ id: 300, author: { type: "teacher" }, content: "넵 준비해주시면 됩니다~" }), cm({ id: 100 })];
    const r = selectNewComments(list, { knownCount: 1, actualCount: 2 });
    expect(r.picked).toEqual([]);
  });

  it("한 번에 여러 개가 달리면 전부(학부모 것만) 잡는다", () => {
    const list = [cm({ id: 300 }), cm({ id: 250, author: { type: "teacher" } }), cm({ id: 200 }), cm({ id: 100 })];
    const r = selectNewComments(list, { knownCount: 1, actualCount: 4 });
    expect(r.picked.map((k) => k.id)).toEqual([200, 300]); // 오래된 것 → 최신 순
  });

  it("전건을 못 보면 **추측하지 않는다**(incomplete) — 피드 수와 응답 수가 다를 때", () => {
    // 조회와 피드 사이에 댓글이 끼어들었거나 페이지네이션 밖. 여기서 slice를 강행하면 중간 댓글이 영영 샌다.
    const r = selectNewComments([cm({ id: 300 }), cm({ id: 100 })], { knownCount: 1, actualCount: 3 });
    expect(r.incomplete).toBe(true);
    expect(r.picked).toEqual([]);
  });

  it("삭제로 수가 줄면 알림 0건 — 그리고 다음 추가는 정상 감지(self-correcting)", () => {
    // ① [100,200,300] known=3에서 200 삭제 → 수 2 → 변화 감지 → 조회
    const afterDelete = selectNewComments([cm({ id: 300 }), cm({ id: 100 })], { knownCount: 3, actualCount: 2 });
    expect(afterDelete.picked).toEqual([]); // slice(3) of 2개 = 0건
    expect(afterDelete.incomplete).toBe(false);
    // ② 이후 known=2로 갱신된 상태에서 400이 달리면 정상 알림
    const afterAdd = selectNewComments([cm({ id: 400 }), cm({ id: 300 }), cm({ id: 100 })], { knownCount: 2, actualCount: 3 });
    expect(afterAdd.picked.map((k) => k.id)).toEqual([400]);
  });

  it("age 가드 — 오래된 댓글은 tooOld로 빠진다(PC가 꺼졌다 켜져도 벨 도배 없음)", () => {
    const old = cm({ id: 300, created: new Date(Date.now() - 5 * 86400000).toISOString() });
    const fresh = cm({ id: 400, created: new Date().toISOString() });
    const r = selectNewComments([fresh, old], { knownCount: 0, actualCount: 2, maxAgeDays: 3 });
    expect(r.picked.map((k) => k.id)).toEqual([400]);
    expect(r.tooOld.map((k) => k.id)).toEqual([300]);
  });

  it("created가 깨져도 버리지 않는다(순서는 id가 책임 — created는 age 판정에만)", () => {
    const r = selectNewComments([cm({ id: 300, created: "" })], { knownCount: 0, actualCount: 1 });
    expect(r.picked.map((k) => k.id)).toEqual([300]);
  });

  it("빈 목록·known 0 — 전부 새 것으로 본다", () => {
    expect(selectNewComments([], { knownCount: 0, actualCount: 0 }).picked).toEqual([]);
    expect(selectNewComments([cm({ id: 1 })], { knownCount: 0, actualCount: 1 }).picked.map((k) => k.id)).toEqual([1]);
  });
});

describe("pruneCounts", () => {
  it("상한을 넘으면 **최신 글(id 큰 것)** 우선으로 남긴다", () => {
    const counts = { "1": 0, "5": 1, "3": 2, "9": 3, "7": 4 };
    expect(pruneCounts(counts, 3)).toEqual({ "9": 3, "7": 4, "5": 1 });
  });

  it("상한 이내면 그대로(복사본)", () => {
    const counts = { "1": 0, "2": 1 };
    const out = pruneCounts(counts, 10);
    expect(out).toEqual(counts);
    expect(out).not.toBe(counts); // 호출부가 원본을 변형하지 않도록
  });

  it("null/빈 입력에도 안 죽는다", () => {
    expect(pruneCounts(null, 5)).toEqual({});
  });
});

describe("buildCommentNotificationText", () => {
  it("제목으로 글 알림과 구분되고, 본문은 벨에서 바로 읽힌다", () => {
    const { title, body } = buildCommentNotificationText(cm({ content: "  오늘   결석입니다 " }), "이상윤");
    expect(title).toBe("이상윤 학부모 댓글");
    expect(body).toBe("오늘 결석입니다"); // 공백 정규화
  });

  it("첨부·스티커만 있어도 왜 알림이 왔는지 알려준다", () => {
    expect(buildCommentNotificationText(cm({ content: "", attached_images: [{}, {}] }), "이상윤").body).toBe(
      "[사진 2장] (내용 없이 첨부만)",
    );
    expect(buildCommentNotificationText(cm({ content: "", emoticon_content: { id: 1 } }), "이상윤").body).toBe(
      "[스티커] (내용 없이 첨부만)",
    );
    expect(buildCommentNotificationText(cm({ content: "", attached_video: { id: 1 }, attached_files: [{}] }), "이상윤").body).toBe(
      "[파일 1개·영상] (내용 없이 첨부만)",
    );
  });

  it("아무것도 없는 댓글도 문구가 나온다", () => {
    expect(buildCommentNotificationText(cm({ content: "" }), "이상윤").body).toBe("학부모님이 댓글을 남겼습니다");
  });

  it("긴 본문은 200자에서 자른다", () => {
    const body = buildCommentNotificationText(cm({ content: "가".repeat(300) }), "이상윤").body;
    expect(body).toHaveLength(201); // 200자 + …
    expect(body.endsWith("…")).toBe(true);
  });
});
