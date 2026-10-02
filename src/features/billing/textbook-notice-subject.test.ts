// 교재 발송 알림장 기본값(2026-10-02 김지우 — 수학 교재가 영어 알림장으로 나간 사고).
import { describe, expect, it } from "vitest";
import { defaultNoticeSubject, initialNoticePicks, resolveNoticeOwners } from "./textbook-notice-subject";

const BOARD: Record<string, string> = { math: "(수학)", subject_1: "(수학)", english: "(영어)" };
const boardOf = (s: string) => BOARD[s];
const MATH_T = "t-math";
const ENG_T = "t-eng";

describe("defaultNoticeSubject", () => {
  it("과목이 하나면 그 과목 · 없으면 null", () => {
    expect(defaultNoticeSubject({ subjects: ["math"], classes: [], owners: [], boardOf })).toBe("math");
    expect(defaultNoticeSubject({ subjects: [], classes: [], owners: [], boardOf })).toBeNull();
  });

  it("🔴 두 과목을 다 듣는 학생 — 요청을 낸 선생님이 가르치는 반의 과목(가나다순 첫 과목이 아니다)", () => {
    const classes = [
      { subject: "english", teacherIds: [ENG_T] },
      { subject: "math", teacherIds: [MATH_T] },
    ];
    const subjects = ["english", "math"];
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: MATH_T, subjects: ["math"] }], boardOf })).toBe("math");
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: ENG_T, subjects: ["english"] }], boardOf })).toBe("english");
  });

  it("담임이 아니어도 교시 담당이면 그 반의 과목", () => {
    const classes = [
      { subject: "english", teacherIds: [ENG_T] },
      { subject: "math", teacherIds: ["t-homeroom", MATH_T] },
    ];
    expect(defaultNoticeSubject({ subjects: ["english", "math"], classes, owners: [{ id: MATH_T, subjects: [] }], boardOf })).toBe("math");
  });

  it("같은 보드로 가는 과목(math·subject_1)은 한 묶음 — 접힌 목록에 남은 키를 돌려준다", () => {
    const classes = [
      { subject: "english", teacherIds: [ENG_T] },
      { subject: "subject_1", teacherIds: [MATH_T] },
    ];
    expect(defaultNoticeSubject({ subjects: ["english", "math"], classes, owners: [{ id: MATH_T, subjects: [] }], boardOf })).toBe("math");
  });

  it("그 학생의 반을 맡고 있지 않으면 담당 과목으로 — 한 보드와만 겹칠 때", () => {
    const classes = [
      { subject: "english", teacherIds: [ENG_T] },
      { subject: "math", teacherIds: ["t-other"] },
    ];
    const subjects = ["english", "math"];
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: MATH_T, subjects: ["math"] }], boardOf })).toBe("math");
    // 담당 과목이 둘 다면 정하지 않는다
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: "t-both", subjects: ["math", "english"] }], boardOf })).toBeNull();
  });

  it("🔴 못 정하면 null — 주인을 모름 · 주인이 두 과목을 다 가르침(담당 과목으로 넘어가지 않는다)", () => {
    const subjects = ["english", "math"];
    const classes = [
      { subject: "english", teacherIds: ["t-both"] },
      { subject: "math", teacherIds: ["t-both"] },
    ];
    expect(defaultNoticeSubject({ subjects, classes, owners: [], boardOf })).toBeNull();
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: "t-both", subjects: ["math"] }], boardOf })).toBeNull();
    // 사무실 직원(담당 과목·반 없음)
    expect(defaultNoticeSubject({ subjects, classes, owners: [{ id: "office", subjects: [] }], boardOf })).toBeNull();
  });
});

describe("resolveNoticeOwners — 요청서의 주인", () => {
  const acc = (id: string, displayName: string, role = "teacher", subjects: string[] = []) => ({ id, displayName, role, subjects });
  const SUJIN = acc("u-sujin", "이수진", "teacher", ["math"]);
  const GREEN = acc("u-green", "김그린", "admin", ["english"]);
  const DESK = acc("u-desk", "주영미", "viewer", ["math"]);

  it("요청서에 적힌 이름과 같은 재직 계정이 하나면 그 계정(작성자가 누구든 — 대리 작성)", () => {
    expect(resolveNoticeOwners({ teacherName: " 이수진 ", createdBy: "u-desk" }, [SUJIN, DESK])).toEqual([{ id: "u-sujin", subjects: ["math"] }]);
  });
  it("이름이 비었으면 작성자 · 강사가 아닌 작성자는 담당 과목을 쓰지 않는다(반 담당 판정만 남는다)", () => {
    expect(resolveNoticeOwners({ teacherName: null, createdBy: "u-sujin" }, [SUJIN])).toEqual([{ id: "u-sujin", subjects: ["math"] }]);
    expect(resolveNoticeOwners({ teacherName: "", createdBy: "u-desk" }, [DESK])).toEqual([{ id: "u-desk", subjects: [] }]);
    expect(resolveNoticeOwners({ teacherName: null, createdBy: "u-green" }, [GREEN])).toEqual([{ id: "u-green", subjects: [] }]);
    // 요청 폼은 담임 칸을 작성자 이름으로 채운다 — 이름으로 찾은 길에서도 같다
    expect(resolveNoticeOwners({ teacherName: "주영미", createdBy: "u-desk" }, [DESK])).toEqual([{ id: "u-desk", subjects: [] }]);
  });
  it("🔴 이름이 다른 사람을 가리키는데 계정을 못 찾으면(별칭·퇴사자) 작성자로 넘기지 않는다 — 주인 없음", () => {
    expect(resolveNoticeOwners({ teacherName: "셀린T", createdBy: "u-sujin" }, [SUJIN])).toEqual([]);
    expect(resolveNoticeOwners({ teacherName: "퇴사한선생님", createdBy: null }, [SUJIN])).toEqual([]);
  });
  it("같은 이름 계정이 둘 — 그 안에 작성자가 있으면 작성자, 없으면 주인 없음", () => {
    const twin = acc("u-sujin2", "이수진", "teacher", ["english"]);
    expect(resolveNoticeOwners({ teacherName: "이수진", createdBy: "u-sujin2" }, [SUJIN, twin])).toEqual([{ id: "u-sujin2", subjects: ["english"] }]);
    expect(resolveNoticeOwners({ teacherName: "이수진", createdBy: "u-desk" }, [SUJIN, twin, DESK])).toEqual([]);
  });
});

describe("initialNoticePicks — 발송 창의 알림장 초기 선택", () => {
  it("학생별 기본값이 전부 같을 때만 채운다 · 학생 연결 없는 요청은 건너뛴다", () => {
    expect(initialNoticePicks([
      { studentId: "s1", defaultSubject: "math" },
      { studentId: "s1", defaultSubject: "math" },
      { studentId: "s2", defaultSubject: "english" },
      { studentId: null, defaultSubject: "math" },
    ])).toEqual({ s1: "math", s2: "english" });
  });
  it("🔴 한 건이라도 못 정했거나 서로 다르면 비워 둔다(첫 건의 과목으로 묶어 보내지 않는다)", () => {
    expect(initialNoticePicks([
      { studentId: "s1", defaultSubject: "math" },
      { studentId: "s1", defaultSubject: "english" },
      { studentId: "s2", defaultSubject: null },
      { studentId: "s2", defaultSubject: "math" },
      { studentId: "s3", defaultSubject: null },
    ])).toEqual({});
  });
});
