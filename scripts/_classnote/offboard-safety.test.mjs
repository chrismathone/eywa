import { describe, it, expect } from "vitest";
import { carerPhones, dayDiff, evaluateBoardRelease, evaluateOffboardCandidate, isProtectedName, isSystemBulkWithdrawal, normalizePhone, ownedBoardNames, phoneMatches } from "./offboard-safety.mjs";

// 픽스처는 실사례 기반이지만 **개인정보를 제거**했다(이름은 실제 사고 케이스만 유지, username은 u1 형식).
// 2026 학년도 기준: 중2 = 2012년생, 고2 = 2009년생, 초6 = 2014년생(expectedBirthYear).
const TODAY = "2026-07-30";
const SCHOOL_YEAR = 2026;
const GRACE = 45;

/** 전 가드를 통과하는 기본 사실 — 각 테스트는 필요한 조각만 덮어쓴다. */
function facts(over = {}) {
  const base = {
    child: { id: 500, name: "학생A", birth: "2012-05-05", parentId: 900, parentName: "보호자A", parentUsername: "u1" },
    matchedStudentCount: 1,
    reverseMatchCount: 1,
    student: {
      id: "s1",
      name: "학생A",
      grade: "중2",
      status: "withdrawn",
      activeSubjects: [],
      withdrawnAt: "2026-05-01", // 90일 경과
    },
    childDetail: { status: "ok", enrollments: [{ belong_to_class: 10, class_name: "(수학)학생A", isStudentBoard: true }] },
    ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: 1 }], nameConflicts: 0 },
    broadcastBoardIds: [999],
    erpNameEvidence: { activeRows: 1, outRows: 0 },
    activity: {},
    boardPosts: { complete: true, count: 4, lastPostAt: "2026-05-01" },
    studentAnyPost: { complete: true, lastPostAt: "2026-05-01" },
    phone: { checked: true, match: true },
    billing: { lastPeriod: "2026-04", lastPaidAt: "2026-04-20" },
    enrollmentEnd: "2026-04-30",
    today: TODAY,
    schoolYear: SCHOOL_YEAR,
    graceDays: GRACE,
  };
  return { ...base, ...over };
}

describe("dayDiff — KST date-only 일수(타임존 개입 없음)", () => {
  it("같은 날 0, 하루 1", () => {
    expect(dayDiff("2026-07-30", "2026-07-30")).toBe(0);
    expect(dayDiff("2026-07-29", "2026-07-30")).toBe(1);
  });

  it("미래 퇴원일은 음수", () => {
    expect(dayDiff("2026-08-05", "2026-07-30")).toBe(-6);
  });

  it("⭐ 윤년 경계(2028-02-28 → 03-01 = 2일)", () => {
    expect(dayDiff("2028-02-28", "2028-03-01")).toBe(2);
    expect(dayDiff("2027-02-28", "2027-03-01")).toBe(1);
  });

  it("월·연 경계", () => {
    expect(dayDiff("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("형식 오류·실존하지 않는 날짜·null은 null", () => {
    expect(dayDiff("2026-7-30", "2026-07-30")).toBeNull();
    expect(dayDiff("2026-02-30", "2026-07-30")).toBeNull();
    expect(dayDiff(null, "2026-07-30")).toBeNull();
    expect(dayDiff("2026-05-01", "")).toBeNull();
  });
});

describe("ownedBoardNames — 활성 수강과 무관", () => {
  it("⭐ 퇴원생(활성 수강 0)도 수학·영어 보드를 '자기 보드'로 갖는다 — provision 기대집합을 쓰면 전부 foreign 오차단", () => {
    expect(ownedBoardNames("학생A")).toEqual(["(수학)학생A", "(영어)학생A"]);
  });

  it("빈 이름은 빈 배열", () => {
    expect(ownedBoardNames("")).toEqual([]);
    expect(ownedBoardNames(null)).toEqual([]);
  });
});

describe("전 가드 통과 = offboard", () => {
  it("퇴원 90일 경과 + 신원 확정 + 자기 보드만 = 후보", () => {
    const v = evaluateOffboardCandidate(facts());
    expect(v.action).toBe("offboard");
    expect(v.primaryCode).toBe("ok");
    expect(v.matchedCodes).toEqual([]);
    expect(v.factsComplete).toBe(true);
    expect(v.snapshot).toMatchObject({ childId: 500, parentId: 900, boardIds: [10] });
  });

  it("⭐ 수학·영어 두 보드에 다 소속돼 있어도 자기 보드면 통과", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A" },
            { belong_to_class: 11, class_name: "(영어)학생A" },
          ],
        },
        ownedBoards: {
          scanComplete: true,
          boards: [
            { id: 10, name: "(수학)학생A", children: 1 },
            { id: 11, name: "(영어)학생A", children: 1 },
          ],
        },
      }),
    );
    expect(v.action).toBe("offboard");
  });

  it("⭐ 보드가 없어도(scanComplete=true, boards=[]) 후보가 된다 — 명부에만 남은 잔존자가 이 경로", () => {
    const v = evaluateOffboardCandidate(
      facts({ childDetail: { status: "ok", enrollments: [] }, ownedBoards: { scanComplete: true, boards: [] } }),
    );
    expect(v.action).toBe("offboard");
    expect(v.snapshot.boardIds).toEqual([]);
  });

  it("[ALL] 전체방 소속은 foreign이 아니다", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A" },
            { belong_to_class: 999, class_name: "[ALL] 전체방" },
          ],
        },
      }),
    );
    expect(v.action).toBe("offboard");
  });
});

describe("재원 신호 = exclude(정상 케이스)", () => {
  it("status가 퇴원이 아니면 exclude", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, status: "enrolled" } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("enrolled");
  });

  it("휴원(on_hold)도 exclude", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, status: "on_hold" } }));
    expect(v.primaryCode).toBe("enrolled");
  });

  it("⭐ 퇴원 처리됐는데 발송 과목 수강이 살아 있으면 exclude(명부에서 내리면 그 과목 보드까지 끊긴다)", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, activeSubjects: ["english"] } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("enrolled");
    expect(v.reason).toContain("english");
  });
});

describe("신원 카디널리티 — 접미사 양방향·같은 학년 동명이인", () => {
  it("매칭 0 = no_eywa_match(테스트 계정·퇴사 강사 보드)", () => {
    const v = evaluateOffboardCandidate(facts({ matchedStudentCount: 0, student: null }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("no_eywa_match");
    expect(v.factsComplete).toBe(false);
  });

  it("⭐ 접미사 양방향(박서준·박서준C가 원아 '박서준'에 동시 매칭) = ambiguous_forward", () => {
    const v = evaluateOffboardCandidate(facts({ matchedStudentCount: 2 }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("ambiguous_forward");
  });

  it("⭐ 같은 학년 동명이인은 생년 대조로 안 갈린다 — 카디널리티가 잡는다", () => {
    // 둘 다 중2(2012년생)라 생년은 통과하지만 후보가 2명이므로 제외.
    const v = evaluateOffboardCandidate(facts({ matchedStudentCount: 2, child: { ...facts().child, birth: "2012-01-01" } }));
    expect(v.action).toBe("exclude");
    expect(v.matchedCodes).toContain("ambiguous_forward");
  });

  it("역방향(그 학생에 원아 2명) = ambiguous_reverse", () => {
    const v = evaluateOffboardCandidate(facts({ reverseMatchCount: 2 }));
    expect(v.primaryCode).toBe("ambiguous_reverse");
  });
});

describe("신원 대조(생년 ↔ 학년) — 모르면 제외", () => {
  it("⭐ 퇴원 동명이인 잔존(고2 재원 학생 보드에 붙은 중1 가족 형태) = 생년 불일치로 제외", () => {
    // 김서윤·김채은 실사례 모양: aywa는 고2(2009년생 기대)인데 원아는 2013년생.
    const v = evaluateOffboardCandidate(
      facts({ student: { ...facts().student, grade: "고2" }, child: { ...facts().child, birth: "2013-04-04" } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("identity_unknown");
    expect(v.reason).toContain("생년 불일치");
  });

  it("±1년은 허용(조기입학·유급·오입력)", () => {
    const v = evaluateOffboardCandidate(facts({ child: { ...facts().child, birth: "2011-12-31" } }));
    expect(v.action).toBe("offboard");
  });

  it("학년 없음 = identity_unknown", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, grade: null } }));
    expect(v.primaryCode).toBe("identity_unknown");
  });

  it("원아 생년 없음 = identity_unknown", () => {
    const v = evaluateOffboardCandidate(facts({ child: { ...facts().child, birth: null } }));
    expect(v.primaryCode).toBe("identity_unknown");
  });

  it("원아 상세 조회 실패 = identity_unknown(재시도 대상)", () => {
    const v = evaluateOffboardCandidate(facts({ childDetail: { status: "failed" } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("identity_unknown");
  });
});

describe("ERP 이름 증거 — 제외 방향으로만", () => {
  it("⭐ 명부엔 활성인데 같은 이름 ERP 행에 퇴원일이 있으면 exclude(no_action이 아니다 — 같은 아이라 단정 못 함)", () => {
    const v = evaluateOffboardCandidate(facts({ erpNameEvidence: { activeRows: 1, outRows: 1 } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("erp_link_unknown");
  });

  it("ERP 사실이 없으면 그 가드는 미평가(factsComplete=false)", () => {
    const v = evaluateOffboardCandidate(facts({ erpNameEvidence: null }));
    expect(v.notEvaluatedCodes).toContain("erp_link_unknown");
    expect(v.factsComplete).toBe(false);
  });
});

describe("보드 안전", () => {
  it("⭐ 남의 개인 보드에 소속 = foreign_board(잔존 가족 의심)", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A" },
            { belong_to_class: 77, class_name: "(수학)학생B" },
          ],
        },
      }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("foreign_board");
  });

  it("⭐ 그룹반(1인 보드가 아닌 보드) 소속은 foreign이 아니다 — 이걸 foreign으로 세면 정상 학생이 통째로 오차단(실측 64건)", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A", isStudentBoard: true },
            { belong_to_class: 55, class_name: "[EIE] Let's Speak 2b (화목금 14:20~16:20)", isStudentBoard: false },
          ],
        },
      }),
    );
    expect(v.action).toBe("offboard");
  });

  it("⭐ 보드 카테고리를 판별할 수 없으면(목록에 없는 id) foreign 취급 — 모르면 안 내린다", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A", isStudentBoard: true },
            { belong_to_class: 4242 }, // class_name·isStudentBoard 모두 없음
          ],
        },
      }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("foreign_board");
  });

  it("⭐ 공유 보드(가족 2+) = shared_board(내리면 남의 집도 끊긴다)", () => {
    const v = evaluateOffboardCandidate(
      facts({ ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: 2 }] } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("shared_board");
  });

  it("인원 미확인(children=null) = members_unknown", () => {
    const v = evaluateOffboardCandidate(
      facts({ ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: null }] } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("members_unknown");
  });

  it("보드 전건 조회 실패 = board_scan_failed", () => {
    const v = evaluateOffboardCandidate(facts({ ownedBoards: { scanComplete: false, boards: [] } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("board_scan_failed");
  });

  it("보드에 가족 1명인데 그게 이 원아가 아니면 input_inconsistent", () => {
    const v = evaluateOffboardCandidate(facts({ childDetail: { status: "ok", enrollments: [] } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("input_inconsistent");
  });

  it("이 원아가 소속인데 보드 인원이 0이면 input_inconsistent", () => {
    const v = evaluateOffboardCandidate(
      facts({ ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: 0 }] } }),
    );
    expect(v.primaryCode).toBe("input_inconsistent");
  });

  it("같은 이름 보드가 여러 개면 input_inconsistent(대상 특정 불가)", () => {
    const v = evaluateOffboardCandidate(
      facts({ ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: 1 }], nameConflicts: 1 } }),
    );
    expect(v.primaryCode).toBe("input_inconsistent");
  });

  it("removed_child 소속은 무시한다", () => {
    const v = evaluateOffboardCandidate(
      facts({
        childDetail: {
          status: "ok",
          enrollments: [
            { belong_to_class: 10, class_name: "(수학)학생A" },
            { belong_to_class: 77, class_name: "(수학)학생B", removed_child: true },
          ],
        },
      }),
    );
    expect(v.action).toBe("offboard");
  });
});

describe("복구 스냅샷 — 없으면 시작하지 않는다", () => {
  it("부모 식별자 없음 = snapshot_incomplete", () => {
    const v = evaluateOffboardCandidate(
      facts({ child: { ...facts().child, parentId: null, parentName: null, parentUsername: null } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("snapshot_incomplete");
  });

  it("parentUsername만 있어도 스냅샷은 성립", () => {
    const v = evaluateOffboardCandidate(facts({ child: { ...facts().child, parentName: null } }));
    expect(v.action).toBe("offboard");
  });
});

describe("유예 45일 — 경계", () => {
  const withDays = (d) => {
    const t = Date.UTC(2026, 6, 30) - d * 86400000;
    const dt = new Date(t);
    const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    return facts({ student: { ...facts().student, withdrawnAt: iso } });
  };

  it("44일 = hold", () => {
    const v = evaluateOffboardCandidate(withDays(44));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("grace");
  });

  it("⭐ 45일 = 통과(경계 포함)", () => {
    expect(evaluateOffboardCandidate(withDays(45)).action).toBe("offboard");
  });

  it("46일 = 통과", () => {
    expect(evaluateOffboardCandidate(withDays(46)).action).toBe("offboard");
  });

  it("미래 퇴원일 = hold", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, withdrawnAt: "2026-08-10" } }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("grace");
  });

  it("퇴원일 없음/형식 오류 = hold(경과를 확인할 수 없으면 내리지 않는다)", () => {
    expect(evaluateOffboardCandidate(facts({ student: { ...facts().student, withdrawnAt: null } })).primaryCode).toBe("grace");
    expect(evaluateOffboardCandidate(facts({ student: { ...facts().student, withdrawnAt: "2026-7-1" } })).primaryCode).toBe("grace");
  });
});

describe("최근 활동 = hold", () => {
  it("최근 발송이 있으면 hold", () => {
    const v = evaluateOffboardCandidate(facts({ activity: { lastReportSentAt: "2026-07-20" } }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("recent_activity");
  });

  it("최근/예정 수강 시작이 있으면 hold", () => {
    const v = evaluateOffboardCandidate(facts({ activity: { recentEnrollmentStart: "2026-08-01" } }));
    expect(v.primaryCode).toBe("recent_activity");
  });

  it("학부모 글·댓글 알림(이름 일치)만으로도 hold — 약한 신호지만 방향이 안전하다", () => {
    const v = evaluateOffboardCandidate(facts({ activity: { inboundNameHit: true } }));
    expect(v.primaryCode).toBe("recent_activity");
  });
});

describe("우선순위 — exclude > hold, 같은 랭크는 표 순서", () => {
  it("⭐ 유예 미경과 + 남의 보드 소속이면 exclude가 이긴다(위험이 hold 뒤에 숨지 않는다)", () => {
    const v = evaluateOffboardCandidate(
      facts({
        student: { ...facts().student, withdrawnAt: "2026-07-20" }, // 10일
        childDetail: { status: "ok", enrollments: [{ belong_to_class: 77, class_name: "(수학)학생B" }] },
      }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("foreign_board");
    expect(v.matchedCodes).toContain("grace");
  });

  it("재원 신호가 다른 exclude보다 먼저 보고된다(정상 케이스를 먼저 치운다)", () => {
    const v = evaluateOffboardCandidate(
      facts({
        student: { ...facts().student, status: "enrolled" },
        ownedBoards: { scanComplete: true, boards: [{ id: 10, name: "(수학)학생A", children: 2 }] },
      }),
    );
    expect(v.primaryCode).toBe("enrolled");
    expect(v.matchedCodes).toEqual(expect.arrayContaining(["enrolled", "shared_board"]));
  });

  it("hold 둘이 겹치면 grace가 primary", () => {
    const v = evaluateOffboardCandidate(
      facts({ student: { ...facts().student, withdrawnAt: "2026-07-20" }, activity: { inboundNameHit: true } }),
    );
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("grace");
    expect(v.matchedCodes).toEqual(expect.arrayContaining(["grace", "recent_activity"]));
  });
});

describe("2-pass 계약 — 미평가를 숨기지 않는다", () => {
  it("⭐ 1-pass(상세 미수집)에서는 foreign_board·input_inconsistent가 미평가로 남는다", () => {
    const v = evaluateOffboardCandidate(
      facts({ student: { ...facts().student, status: "enrolled" }, childDetail: { status: "not_collected" } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.factsComplete).toBe(false);
    expect(v.notEvaluatedCodes).toEqual(expect.arrayContaining(["foreign_board", "input_inconsistent"]));
  });

  it("⭐ 1-pass에서 hold였던 행이 2-pass에서 foreign_board로 드러나면 최종 exclude", () => {
    const one = evaluateOffboardCandidate(
      facts({ student: { ...facts().student, withdrawnAt: "2026-07-20" }, childDetail: { status: "not_collected" } }),
    );
    expect(one.action).toBe("hold");
    expect(one.factsComplete).toBe(false);

    const two = evaluateOffboardCandidate(
      facts({
        student: { ...facts().student, withdrawnAt: "2026-07-20" },
        childDetail: { status: "ok", enrollments: [{ belong_to_class: 77, class_name: "(수학)학생B" }] },
      }),
    );
    expect(two.action).toBe("exclude");
    expect(two.primaryCode).toBe("foreign_board");
  });
});

describe("전화 대조 — 최상위 신원 증거(원장 제안)", () => {
  it("정규화: 하이픈·공백·+82를 흡수한다", () => {
    expect(normalizePhone("010-0000-9102")).toBe("01000009102");
    expect(normalizePhone("010 0000 9102")).toBe("01000009102");
    expect(normalizePhone("+82 10-0000-9102")).toBe("01000009102");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("1234")).toBe("");
  });

  it("phoneMatches: 한쪽이라도 비면 null(대조 불가), 공통 번호면 true", () => {
    expect(phoneMatches(["010-1111-2222"], ["01011112222"])).toBe(true);
    expect(phoneMatches(["010-1111-2222"], ["010-3333-4444"])).toBe(false);
    expect(phoneMatches([], ["01011112222"])).toBeNull();
    expect(phoneMatches(["010-1111-2222"], [])).toBeNull();
  });

  it("carerPhones: 명부의 carer1~N 전부 — 빈 값은 빼고, phones에 쓸 값이 없으면 phone(carer1) 하나로(2026-11-04)", () => {
    expect(carerPhones({ phone: "010-1111-2222", phones: ["010-1111-2222", null, "", "010-3333-4444"] })).toEqual(["010-1111-2222", "010-3333-4444"]);
    expect(carerPhones({ phone: "010-1111-2222", phones: [null, ""] })).toEqual(["010-1111-2222"]);
    expect(carerPhones({ phone: "010-1111-2222", phones: [] })).toEqual(["010-1111-2222"]);
    expect(carerPhones({ phone: "010-1111-2222" })).toEqual(["010-1111-2222"]);
    expect(carerPhones({ phone: null, phones: [null, ""] })).toEqual([]);
    expect(carerPhones(null)).toEqual([]);
    expect(carerPhones(undefined)).toEqual([]);
    // 숫자가 안 남는 값(공백·'-'·'없음'·너무 짧은 번호)은 전화로 치지 않는다
    expect(carerPhones({ phone: "010-1111-2222", phones: [" ", "-", "없음", "1234"] })).toEqual(["010-1111-2222"]);
    expect(carerPhones({ phone: "없음", phones: [" "] })).toEqual([]);
  });

  it("⭐ 전화 불일치면 exclude — 이름·생년이 다 맞아도 다른 집이다", () => {
    const v = evaluateOffboardCandidate(facts({ phone: { checked: true, match: false } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("phone_mismatch");
  });

  it("전화 일치는 통과에 영향 없음(다른 가드가 그대로 작동)", () => {
    expect(evaluateOffboardCandidate(facts({ phone: { checked: true, match: true } })).action).toBe("offboard");
  });

  it("대조 불가(checked=false)면 미평가로 남는다 — 있는 척하지 않는다", () => {
    const v = evaluateOffboardCandidate(facts({ phone: { checked: false, match: null } }));
    expect(v.notEvaluatedCodes).toContain("phone_mismatch");
  });
});

describe("ClassNote 무게시 45일(원장 기준) — Operation B", () => {
  it("⭐ 최근 게시물이 있으면 hold", () => {
    const v = evaluateOffboardCandidate(facts({ boardPosts: { complete: true, count: 3, lastPostAt: "2026-07-20" } }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("recent_posts");
  });

  it("45일 이상 무게시면 통과", () => {
    expect(evaluateOffboardCandidate(facts({ boardPosts: { complete: true, count: 3, lastPostAt: "2026-05-01" } })).action).toBe("offboard");
  });

  it("게시물 0건도 통과(마지막 게시물 없음)", () => {
    expect(evaluateOffboardCandidate(facts({ boardPosts: { complete: true, count: 0, lastPostAt: null } })).action).toBe("offboard");
  });

  it("⭐ 이력이 불완전하면 exclude — 무활동을 증명할 수 없다(커서로 이어받으면 필터가 풀린다)", () => {
    const v = evaluateOffboardCandidate(facts({ boardPosts: { complete: false, count: 100, lastPostAt: "2026-05-01" } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("posts_unknown");
  });
});

describe("Operation A — 보드 삭제·배정해제(과목별)", () => {
  const rel = (over = {}) =>
    evaluateBoardRelease({
      board: { id: 10, name: "(수학)학생A", children: 1 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-05-01" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 4, lastPostAt: "2026-05-01" },
      studentAnyPost: { complete: true, lastPostAt: "2026-05-01" },
      billing: { lastPeriod: "2026-04", lastPaidAt: "2026-04-20" },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
      ...over,
    });

  it("전 가드 통과 = release", () => {
    const v = rel();
    expect(v.action).toBe("release");
    expect(v.primaryCode).toBe("ok");
    expect(v.factsComplete).toBe(true);
  });

  it("⭐ 게시물이 있어도 45일 이상 조용하면 release — 원장 기준(추억은 보드 삭제 시 사라짐을 수용)", () => {
    expect(rel({ posts: { complete: true, count: 19, lastPostAt: "2026-04-01" } }).action).toBe("release");
  });

  it("⭐ 일부 과목만 퇴원한 학생: 보드 정리는 되지만 alsoOffboard=false(명부는 건드리면 안 됨)", () => {
const v = rel({ student: { id: "s1", name: "학생A", status: "enrolled", subjectActive: false, allSubjectsEnded: false, withdrawnAt: null } });
    expect(v.action).toBe("release");
    expect(v.alsoOffboard).toBe(false);
  });

  it("⭐ 전과목 퇴원 + 유예 경과면 alsoOffboard=true", () => {
    expect(rel().alsoOffboard).toBe(true);
  });

  it("⭐⭐ 보드 삭제는 되지만 퇴원 20일차면 alsoOffboard=false — 명부 퇴원처리는 비가역이라 유예를 요구한다", () => {
    const v = rel({ student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-07-10" } });
    expect(v.action).toBe("release");
    expect(v.alsoOffboard).toBe(false);
  });

  it("퇴원일이 없으면 alsoOffboard=false(경과를 증명 못 함)", () => {
    expect(rel({ student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: null } }).alsoOffboard).toBe(false);
  });

  it("그 과목을 아직 수강 중이면 exclude", () => {
    const v = rel({ student: { id: "s1", name: "학생A", status: "enrolled", subjectActive: true, allSubjectsEnded: false } });
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("subject_active");
  });

  it("최근 게시물이 있으면 hold", () => {
    expect(rel({ posts: { complete: true, count: 2, lastPostAt: "2026-07-25" } }).primaryCode).toBe("recent_posts");
  });

  it("공유 보드(가족 2+)는 exclude — 배정 해제가 남의 집을 끊는다", () => {
    const v = rel({ board: { id: 10, name: "(수학)학생A", children: 2 } });
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("shared_board");
  });

  it("교사 연결이 있으면 hold(ClassNote가 삭제를 거부한다)", () => {
    expect(rel({ teachers: 1 }).primaryCode).toBe("teacher_linked");
  });

  it("전화 불일치·미매칭·동명이인은 exclude", () => {
    expect(rel({ phone: { checked: true, match: false } }).primaryCode).toBe("phone_mismatch");
    expect(rel({ matchedStudentCount: 0, student: null }).primaryCode).toBe("no_eywa_match");
    expect(rel({ matchedStudentCount: 2 }).primaryCode).toBe("ambiguous");
  });

  it("인원·게시물 미확인은 exclude(모르면 안 지운다)", () => {
    expect(rel({ board: { id: 10, name: "(수학)학생A", children: null } }).primaryCode).toBe("members_unknown");
    expect(rel({ posts: { complete: false, count: 100, lastPostAt: null } }).primaryCode).toBe("posts_unknown");
  });
});

describe("Operation A 우선순위 — '정상, 대상 아님'을 먼저 보고한다", () => {
  it("⭐ 수강 중 + 전화 불일치가 겹치면 primaryCode는 subject_active(활발한 학생을 '전화 불일치'로 헤드라인 잡지 않는다)", () => {
    const v = evaluateBoardRelease({
      board: { id: 10, name: "(수학)학생A", children: 1 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "enrolled", subjectActive: true, allSubjectsEnded: false, withdrawnAt: null },
      phone: { checked: true, match: false },
      posts: { complete: true, count: 40, lastPostAt: "2026-07-29" },
      teachers: 2,
      today: TODAY,
      dormantDays: 45,
    });
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("subject_active");
    expect(v.matchedCodes).toEqual(expect.arrayContaining(["subject_active", "phone_mismatch", "recent_posts", "teacher_linked"]));
  });
});

describe("⭐ 원장 백스톱 — 최근 7일 내 '어떠한 보고서라도' 있으면 퇴원처리 불가", () => {
  it("최근 7일 내 게시물이 있으면 hold(Op B)", () => {
    const v = evaluateOffboardCandidate(facts({ studentAnyPost: { complete: true, lastPostAt: "2026-07-28" } }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("recent_any_post");
  });

  it("7일 경계: 7일 전은 통과, 6일 전은 hold", () => {
    expect(evaluateOffboardCandidate(facts({ studentAnyPost: { complete: true, lastPostAt: "2026-07-23" } })).action).toBe("offboard");
    expect(evaluateOffboardCandidate(facts({ studentAnyPost: { complete: true, lastPostAt: "2026-07-24" } })).primaryCode).toBe("recent_any_post");
  });

  it("이력이 불완전하면 hold(모르면 안 내린다)", () => {
    expect(evaluateOffboardCandidate(facts({ studentAnyPost: { complete: false, lastPostAt: null } })).primaryCode).toBe("recent_any_post");
  });

  it("게시물이 아예 없으면 통과", () => {
    expect(evaluateOffboardCandidate(facts({ studentAnyPost: { complete: true, lastPostAt: null } })).action).toBe("offboard");
  });

  it("⭐ Op A의 alsoOffboard도 이 백스톱을 본다 — 보드 삭제는 되지만 퇴원처리는 막힌다", () => {
    const base = {
      board: { id: 10, name: "(수학)학생A", children: 0 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-05-01" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 0, lastPostAt: null },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
    };
    // 영어 보드에 3일 전 보고서가 올라온 학생: 수학 보드 삭제는 OK, 명부 퇴원처리는 금지
    const recent = evaluateBoardRelease({ ...base, studentAnyPost: { complete: true, lastPostAt: "2026-07-27" } });
    expect(recent.action).toBe("release");
    expect(recent.alsoOffboard).toBe(false);
    const quiet = evaluateBoardRelease({ ...base, studentAnyPost: { complete: true, lastPostAt: "2026-04-01" } });
    expect(quiet.alsoOffboard).toBe(true);
  });

  it("studentAnyPost를 안 넘기면 alsoOffboard=false(모르면 안 내린다)", () => {
    const v = evaluateBoardRelease({
      board: { id: 10, name: "(수학)학생A", children: 0 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-05-01" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 0, lastPostAt: null },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
    });
    expect(v.action).toBe("release");
    expect(v.alsoOffboard).toBe(false);
  });
});

describe("🔴 보호 계정 — 우연한 제외에 기대지 않는다(원장 지적)", () => {
  it("isProtectedName: 보드명·학생명 어느 쪽이든 판정", () => {
    expect(isProtectedName("학원이")).toBe(true);
    expect(isProtectedName("(수학)학원이")).toBe(true);
    expect(isProtectedName("(영어)학원삼")).toBe(true);
    expect(isProtectedName("학원")).toBe(false);
    expect(isProtectedName("학원이다")).toBe(false); // 부분일치 금지
  });

  it("⭐ 전 가드를 통과하는 조건이어도 보호 계정이면 퇴원처리 exclude(전화까지 맞아도)", () => {
    const v = evaluateOffboardCandidate(
      facts({ child: { id: 500, name: "학원이", birth: "2012-05-05", parentId: 900, parentName: "보호자A", parentUsername: "u1" } }),
    );
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("protected_account");
  });

  it("⭐ 보드 삭제(Op A)도 보호된다", () => {
    const v = evaluateBoardRelease({
      board: { id: 10, name: "(수학)학원이", children: 0 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학원이", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-01-01" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 0, lastPostAt: null },
      studentAnyPost: { complete: true, lastPostAt: null },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
    });
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("protected_account");
    expect(v.alsoOffboard).toBe(false);
  });
});

describe("🔴 시스템 일괄 퇴원(2026-07-10) — 퇴원목록에서 잡지 않는다(원장 지시)", () => {
  it("isSystemBulkWithdrawal", () => {
    expect(isSystemBulkWithdrawal("2026-07-10")).toBe(true);
    expect(isSystemBulkWithdrawal("2026-07-13")).toBe(false);
    expect(isSystemBulkWithdrawal(null)).toBe(false);
  });

  it("⭐ 다른 가드를 다 통과해도 07-10 퇴원분은 exclude", () => {
    const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, withdrawnAt: "2026-07-10" } }));
    expect(v.action).toBe("exclude");
    expect(v.primaryCode).toBe("system_withdrawal");
  });

  it("⭐ 보드 삭제는 그대로 가능하되 alsoOffboard=false — 장부 날짜는 퇴원처리 근거가 못 된다", () => {
    const v = evaluateBoardRelease({
      board: { id: 10, name: "(영어)학생A", children: 0 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-07-10" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 0, lastPostAt: null },
      studentAnyPost: { complete: true, lastPostAt: null },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
    });
    expect(v.action).toBe("release");
    expect(v.alsoOffboard).toBe(false);
  });

  it("일괄일이 아닌 퇴원은 정상 처리(07-13은 대상)", () => {
const v = evaluateOffboardCandidate(facts({ student: { ...facts().student, withdrawnAt: "2026-01-13" }, billing: { lastPeriod: "2026-01", lastPaidAt: "2026-01-10" }, enrollmentEnd: "2026-01-13" }));
    expect(v.action).toBe("offboard");
  });
});

describe("🔴 돈의 흔적 — 퇴원 이후 청구·납부는 '실제로 다닌다'는 신호(실측 배한빈)", () => {
  it("⭐ 퇴원 다음 달 청구가 있으면 hold", () => {
    const v = evaluateOffboardCandidate(facts({ billing: { lastPeriod: "2026-07", lastPaidAt: null } }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("recent_billing");
  });

  it("⭐ 퇴원 이후 납부가 있으면 hold", () => {
    const v = evaluateOffboardCandidate(facts({ billing: { lastPeriod: null, lastPaidAt: "2026-06-30" } }));
    expect(v.primaryCode).toBe("recent_billing");
  });

  it("퇴원한 달의 청구는 정상(그 달 수업분)", () => {
    const v = evaluateOffboardCandidate(facts({ billing: { lastPeriod: "2026-05", lastPaidAt: "2026-04-30" } }));
    expect(v.action).toBe("offboard");
  });

  it("청구 사실이 없으면 미평가(있는 척하지 않는다)", () => {
    expect(evaluateOffboardCandidate(facts({ billing: null })).notEvaluatedCodes).toContain("recent_billing");
  });

  it("⭐ 퇴원일보다 수강 종료일이 나중이면 hold(실측 주상모A)", () => {
    const v = evaluateOffboardCandidate(facts({ enrollmentEnd: "2026-07-03" }));
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("withdrawal_inconsistent");
  });

  it("수강 종료일이 퇴원일 이전이면 정상", () => {
    expect(evaluateOffboardCandidate(facts({ enrollmentEnd: "2026-04-30" })).action).toBe("offboard");
  });
});

describe("🔴 보드 삭제에도 최근 수납 방어(원장 지시 2026-07-30)", () => {
  const rel2 = (over = {}) =>
    evaluateBoardRelease({
      board: { id: 10, name: "(수학)학생A", children: 0 },
      matchedStudentCount: 1,
      student: { id: "s1", name: "학생A", status: "withdrawn", subjectActive: false, allSubjectsEnded: true, withdrawnAt: "2026-04-06" },
      phone: { checked: true, match: true },
      posts: { complete: true, count: 0, lastPostAt: null },
      studentAnyPost: { complete: true, lastPostAt: null },
      teachers: 0,
      today: TODAY,
      dormantDays: 45,
      billing: { lastPeriod: "2026-04", lastPaidAt: "2026-04-01" },
      ...over,
    });

  it("⭐ 퇴원 이후 청구가 있으면 보드도 안 지운다(배한빈 형태)", () => {
    const v = rel2({ billing: { lastPeriod: "2026-07", lastPaidAt: "2026-06-30" } });
    expect(v.action).toBe("hold");
    expect(v.primaryCode).toBe("recent_billing");
    expect(v.alsoOffboard).toBe(false);
  });

  it("⭐ 퇴원 전 청구라도 납부가 최근 45일 내면 hold(안전측)", () => {
    expect(rel2({ billing: { lastPeriod: "2026-04", lastPaidAt: "2026-07-01" } }).primaryCode).toBe("recent_billing");
  });

  it("오래된 수납만 있으면 통과", () => {
    expect(rel2().action).toBe("release");
  });

  it("수납 사실이 없으면 미평가(있는 척하지 않음)", () => {
    expect(rel2({ billing: null }).notEvaluatedCodes).toContain("recent_billing");
  });
});
