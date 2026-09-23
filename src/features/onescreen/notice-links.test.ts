import { describe, expect, it } from "vitest";
import { boardStudentName, flattenNoticeReportLinks, noticePostedActions, resultsForRetryRevoke } from "./notice-links";

describe("boardStudentName", () => {
  it("과목 접두어를 벗긴다", () => {
    expect(boardStudentName("(수학)김경민")).toBe("김경민");
    expect(boardStudentName("(영어) 최주원")).toBe("최주원");
  });
  it("접두어가 없으면 원문", () => {
    expect(boardStudentName("김경민")).toBe("김경민");
  });
  it("이름이 비면 원문을 지킨다(빈 라벨 방지)", () => {
    expect(boardStudentName("(수학)")).toBe("(수학)");
  });
});

describe("flattenNoticeReportLinks", () => {
  const targets = [
    { studentId: "s1", studentName: "김경민", board: "(수학)김경민" },
    { studentId: "s2", studentName: "최주원", board: "(수학)최주원" },
  ];

  it("targets의 학생 이름을 붙인다", () => {
    const results = [
      { board: "(수학)김경민", ok: true, reports: [{ id: 11, url: "https://x/service/report/11" }] },
      { board: "(수학)최주원", ok: true, reports: [{ id: 12, url: "https://x/service/report/12" }] },
    ];
    expect(flattenNoticeReportLinks(results, targets).map((l) => l.name)).toEqual(["김경민", "최주원"]);
  });

  it("targets에 없으면 보드명에서 이름을 뽑는다", () => {
    const results = [{ board: "(수학)이후성", reports: [{ id: 13, url: "u" }] }];
    expect(flattenNoticeReportLinks(results, [])[0].name).toBe("이후성");
  });

  it("같은 보드 2건(학부모 계정 2개)은 순번을 붙인다", () => {
    const results = [{ board: "(수학)김경민", reports: [{ id: 1, url: "a" }, { id: 2, url: "b" }] }];
    expect(flattenNoticeReportLinks(results, targets).map((l) => l.name)).toEqual(["김경민 (1)", "김경민 (2)"]);
  });

  it("회수 결과(revoked[])도 읽고 revoked 플래그를 보존한다", () => {
    const results = [{ board: "(수학)김경민", revoked: [{ id: 1, url: "a", revoked: true }] }];
    const links = flattenNoticeReportLinks(results, targets);
    expect(links).toEqual([{ url: "a", revoked: true, name: "김경민" }]);
  });

  it("게시 실패 타깃(리포트 없음)은 목록에 넣지 않는다", () => {
    const results = [
      { board: "(수학)김경민", ok: false, note: "학부모 미가입(초대 필요)" },
      { board: "(수학)최주원", ok: true, reports: [{ id: 12, url: "u" }] },
    ];
    expect(flattenNoticeReportLinks(results, targets).map((l) => l.name)).toEqual(["최주원"]);
  });

  it("url 조립 실패(id만)는 링크 없이 남긴다", () => {
    const results = [{ board: "(수학)김경민", reports: [{ id: 7, url: null }] }];
    expect(flattenNoticeReportLinks(results, targets)).toEqual([{ url: "", revoked: false, name: "김경민" }]);
  });

  it("results가 배열이 아니면 빈 목록", () => {
    expect(flattenNoticeReportLinks(null, targets)).toEqual([]);
    expect(flattenNoticeReportLinks(undefined, undefined)).toEqual([]);
  });
});

describe("noticePostedActions · resultsForRetryRevoke (F1·F2)", () => {
  const live = [{ board: "(수학)김경민", reports: [{ id: 1, url: "u" }] }];
  const partialRevoke = [
    { board: "(수학)김경민", revoked: [{ id: 1, url: "u", revoked: true }] },
    { board: "(수학)최주원", revoked: [{ id: 2, url: "v", revoked: false, note: "삭제 실패(500)" }] },
  ];
  it("게시됨은 회수·수정 모두", () => {
    expect(noticePostedActions("success", live, [])).toEqual({ canRevoke: true, canEdit: true });
  });
  it("회수 일부 실패는 남은 글이 있으면 다시 회수만", () => {
    expect(noticePostedActions("revoke_partial", partialRevoke, [])).toEqual({ canRevoke: true, canEdit: false });
    const allGone = [{ board: "b", revoked: [{ id: 1, url: "u", revoked: true }] }];
    expect(noticePostedActions("revoke_partial", allGone, [])).toEqual({ canRevoke: false, canEdit: false });
  });
  it("대기·회수 중은 아무것도 안 된다", () => {
    expect(noticePostedActions("revoke_requested", live, [])).toEqual({ canRevoke: false, canEdit: false });
    expect(noticePostedActions("queued", live, [])).toEqual({ canRevoke: false, canEdit: false });
  });
  it("재회수 results는 워커가 읽는 reports 모양으로", () => {
    expect(resultsForRetryRevoke(partialRevoke)).toEqual([
      { board: "(수학)김경민", reports: [{ id: 1, url: "u", revoked: true }] },
      { board: "(수학)최주원", reports: [{ id: 2, url: "v", revoked: false, note: "삭제 실패(500)" }] },
    ]);
    expect(resultsForRetryRevoke(live)).toEqual(live);
    expect(resultsForRetryRevoke(null)).toBeNull();
  });
});
