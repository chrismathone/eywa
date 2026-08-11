// 병합 계획 순수함수 테스트 — 케이스는 전부 **운영 DB 드라이런(2026-08-11)에서 실제로 나온 모양**이다.
import { describe, expect, it } from "vitest";
import { looksLikePhone, memoDates, planMerge, pickWinner, type ConsultRow } from "./merge-plan";

const row = (o: Partial<ConsultRow> & { id: string }): ConsultRow => ({
  outcome: "consulted",
  consulted_at: "2026-06-23T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
  ...o,
});

const dec = (rows: ConsultRow[], key: string, opts = {}) =>
  planMerge(rows, opts).decisions.find((d) => d.key === key)!;

describe("차단 — 합치면 안 되는 것", () => {
  it("과목이 다르면 별건이다(영어 상담 + 수학 상담)", () => {
    const p = planMerge([row({ id: "a", subject: "english" }), row({ id: "b", subject: "math" })]);
    expect(p.blockers).toContain("과목이 서로 다른 상담입니다(별건)");
  });

  it("한쪽 과목이 비어 있으면 차단하지 않는다(미상은 별건 근거가 아니다)", () => {
    const p = planMerge([row({ id: "a", subject: "math" }), row({ id: "b", subject: null })]);
    expect(p.blockers).toEqual([]);
  });

  it("서로 다른 학생에 연결돼 있으면 이름이 같아도 막는다", () => {
    const p = planMerge([row({ id: "a", student_id: "s1" }), row({ id: "b", student_id: "s2" })]);
    expect(p.blockers).toContain("서로 다른 학생에 연결된 상담입니다");
  });

  it("상담일이 기준일보다 멀면 재방문으로 보고 막는다", () => {
    const p = planMerge(
      [row({ id: "a", consulted_at: "2026-03-01T00:00:00Z" }), row({ id: "b", consulted_at: "2026-09-01T00:00:00Z" })],
      { maxDayGap: 7 },
    );
    expect(p.blockers.join()).toMatch(/떨어져 있습니다/);
  });
});

describe("outcome — 결말은 자동으로 정하지 않는다", () => {
  it("상담 + 등록이면 등록을 남긴다(옛 시트가 상담탭·등록탭에 따로 적은 꼴, 실측 35그룹)", () => {
    const d = dec([row({ id: "a", outcome: "consulted" }), row({ id: "b", outcome: "enrolled" })], "outcome");
    expect(d.status).toBe("resolved");
    expect(d.proposed).toBe("enrolled");
    expect(d.needsHuman).toBe(false);
  });

  it("등록 + 미등록은 사람이 고른다(반대 결말을 랭킹으로 덮으면 안 된다)", () => {
    const d = dec([row({ id: "a", outcome: "declined" }), row({ id: "b", outcome: "enrolled" })], "outcome");
    expect(d.status).toBe("conflict");
    expect(d.needsHuman).toBe(true);
  });
});

describe("전화 — 판독 불가한 값은 묻지 않는다", () => {
  it("암호문(makeedu 이관분)은 전화번호가 아니다", () => {
    expect(looksLikePhone("333D32100E28110C")).toBe(false);
    expect(looksLikePhone("010-1234-5678")).toBe(true);
    expect(looksLikePhone("정유진")).toBe(false);
  });

  it("형식만 다른 같은 번호는 충돌이 아니다", () => {
    const d = dec([row({ id: "a", parent_phone: "010-1234-5678" }), row({ id: "b", parent_phone: "01012345678" })], "parent_phone");
    expect(d.needsHuman).toBe(false);
  });

  it("한쪽이 암호문이면 읽을 수 있는 번호를 남기고 묻지 않는다", () => {
    const d = dec([row({ id: "a", parent_phone: "333D32100E28110C" }), row({ id: "b", parent_phone: "010-1234-5678" })], "parent_phone");
    expect(d.needsHuman).toBe(false);
    expect(d.proposed).toBe("010-1234-5678");
    expect(d.discarded).toContain("333D32100E28110C");
  });

  it("진짜 다른 두 번호면 사람이 고른다", () => {
    const d = dec([row({ id: "a", parent_phone: "010-8855-7380" }), row({ id: "b", parent_phone: "010-5025-8260" })], "parent_phone");
    expect(d.needsHuman).toBe(true);
  });
});

describe("상담 메모 — 이어붙이기 전에 포함 관계를 본다", () => {
  it("누적본이 짧은 쪽을 이미 담고 있으면 누적본만 남긴다(중복 텍스트 금지)", () => {
    const short = "◆24/1/11 진단평가 92점";
    const long = `${short}\n◆24/2/29 레벨조정 진행`;
    const d = dec([row({ id: "a", parent_request: short }), row({ id: "b", parent_request: long })], "parent_request");
    expect(d.proposed).toBe(long);
    expect(String(d.proposed)).not.toContain("──────────");
    expect(d.discarded).toEqual([]);
  });

  it("겹치지 않는 두 기록은 둘 다 남긴다", () => {
    const d = dec(
      [row({ id: "a", parent_request: "레벨테스트 안내함" }), row({ id: "b", parent_request: "셔틀 문의 있었음" })],
      "parent_request",
    );
    expect(d.status).toBe("appended");
    expect(String(d.proposed)).toContain("레벨테스트 안내함");
    expect(String(d.proposed)).toContain("셔틀 문의 있었음");
    expect(d.discarded).toEqual([]);
  });

  it("공백 차이만 있는 같은 글은 이어붙이지 않는다", () => {
    const d = dec(
      [row({ id: "a", parent_request: "레벨테스트  안내" }), row({ id: "b", parent_request: "레벨테스트 안내" })],
      "parent_request",
    );
    expect(String(d.proposed)).not.toContain("──────────");
  });

  it("이어붙이기를 끄면 사람이 고르게 된다", () => {
    const d = dec(
      [row({ id: "a", parent_request: "가" }), row({ id: "b", parent_request: "나" })],
      "parent_request",
      { appendFreeText: false },
    );
    expect(d.needsHuman).toBe(true);
  });
});

describe("시각·학교·이름 — 규칙으로 푸는 것들", () => {
  it("상담 일시는 가장 이른 것을 남긴다(늦은 값은 옮겨 적은 그림자)", () => {
    const d = dec(
      [row({ id: "a", consulted_at: "2026-08-05T06:23:26Z" }), row({ id: "b", consulted_at: "2026-08-05T04:45:41Z" })],
      "consulted_at",
    );
    expect(d.status).toBe("resolved");
    expect(d.proposed).toBe("2026-08-05T04:45:41Z");
  });

  it("같은 학교의 다른 표기는 충돌이 아니다(일중 = 대구일중)", () => {
    const d = dec([row({ id: "a", prospect_school: "일중" }), row({ id: "b", prospect_school: "대구일중" })], "prospect_school");
    expect(d.needsHuman).toBe(false);
  });

  it("급만 남은 잔해('초')는 학교로 치지 않는다", () => {
    const d = dec([row({ id: "a", prospect_school: "동평초" }), row({ id: "b", prospect_school: "초" })], "prospect_school");
    expect(d.needsHuman).toBe(false);
    expect(d.proposed).toBe("동평초");
  });

  it("상담 교사는 어순이 달라도 같은 값이다", () => {
    const d = dec([row({ id: "a", counselor: "예원 대표" }), row({ id: "b", counselor: "대표 예원" })], "counselor");
    expect(d.needsHuman).toBe(false);
  });

  it("한쪽이 다른 쪽을 포함하면 더 많이 적힌 쪽을 남긴다", () => {
    const d = dec([row({ id: "a", counselor: "대표" }), row({ id: "b", counselor: "예원 대표" })], "counselor");
    expect(d.needsHuman).toBe(false);
    expect(d.proposed).toBe("예원 대표");
  });

  it("'-'는 값이 아니라 빈칸 표기다", () => {
    const d = dec([row({ id: "a", counselor: "대표" }), row({ id: "b", counselor: "-" })], "counselor");
    expect(d.needsHuman).toBe(false);
    expect(d.proposed).toBe("대표");
  });

  it("동의 기록은 한쪽에만 있어도 남긴다", () => {
    const d = dec(
      [row({ id: "a", privacy_agreement: false }), row({ id: "b", privacy_agreement: true })],
      "privacy_agreement",
    );
    expect(d.proposed).toBe(true);
    expect(d.needsHuman).toBe(false);
  });
});

describe("세트 — 찢으면 거짓이 되는 것", () => {
  it("녹음이 패자에만 있으면 세트째 가져온다", () => {
    // 승자는 진행 상태가 앞선 a(등록). 녹음은 패자 b에 있으므로 b에서 통째로 옮겨온다.
    const d = dec(
      [row({ id: "a", outcome: "enrolled" }), row({ id: "b", audio_path: "x.m4a", transcription: "전사" })],
      "audio",
    );
    expect(d.status).toBe("filled");
    expect(d.proposed).toBe("b");
  });

  it("승자가 이미 녹음을 갖고 있으면 결정할 게 없다", () => {
    const d = dec([row({ id: "a" }), row({ id: "b", audio_path: "x.m4a", transcription: "전사" })], "audio");
    expect(d.status).toBe("same");
    expect(d.needsHuman).toBe(false);
  });

  it("양쪽에 녹음이 있으면 사람이 고른다(둘 다 남길 수 없다)", () => {
    const d = dec(
      [row({ id: "a", audio_path: "a.m4a" }), row({ id: "b", audio_path: "b.m4a" })],
      "audio",
    );
    expect(d.needsHuman).toBe(true);
  });

  it("결제 금액이 서로 다르면 절대 자동으로 정하지 않는다", () => {
    const d = dec(
      [row({ id: "a", payment_amount: "135000" }), row({ id: "b", payment_amount: "288000" })],
      "payment",
    );
    expect(d.needsHuman).toBe(true);
  });
});

describe("연동 키 — 묻지 않되 경고한다", () => {
  it("makeedu 키를 승자가 못 가져가면 부활 경고를 낸다", () => {
    const p = planMerge([row({ id: "a", makeedu_id: "111" }), row({ id: "b", makeedu_id: "222" })]);
    const d = p.decisions.find((x) => x.key === "makeedu")!;
    expect(d.needsHuman).toBe(false);
    expect(p.warnings.join()).toMatch(/다시 추가될 수 있습니다/);
    expect(p.keyLossCount).toBeGreaterThan(0);
  });

  it("승자에 키가 없으면 패자 키를 가져온다(삭제 후 부활 방지)", () => {
    const p = planMerge([row({ id: "a", audio_path: "a.m4a" }), row({ id: "b", makeedu_id: "222" })]);
    const d = p.decisions.find((x) => x.key === "makeedu")!;
    expect(d.status).toBe("filled");
    expect(d.proposed).toBe("b");
  });
});

describe("승자 선택", () => {
  it("녹음·AI분석을 가진 행이 이긴다(옮기지 않아도 되면 실패 지점이 하나 준다)", () => {
    const w = pickWinner([row({ id: "a", outcome: "enrolled" }), row({ id: "b" })], "composite", {
      b: { ai: 1, rec: 1, push: 0 },
    });
    expect(w.id).toBe("b");
  });
});

describe("메모 날짜 신호", () => {
  it("본문의 ◆ 날짜를 뽑는다", () => {
    expect([...memoDates("◆24/1/11 진단평가 ◆24/2/29 레벨조정")]).toEqual(["2024-01-11", "2024-02-29"]);
  });

  it("겹치지 않는 상담일이 적혀 있으면 별건 의심 경고를 낸다", () => {
    const p = planMerge([
      row({ id: "a", parent_request: "◆24/1/11 진단평가" }),
      row({ id: "b", parent_request: "◆24/2/29 레벨조정" }),
    ]);
    expect(p.warnings.join()).toMatch(/별개 상담일 수 있습니다/);
  });
});

// ── 적대 리뷰(2026-08-11)에서 실제로 잡힌 결함들을 고정한다 ──
describe("적대 검증", () => {
  it("전혀 다른 사람 둘을 합치라고 하면 막아야 한다", () => {
    const p = planMerge([
      row({ id: "a", prospect_name: "김철수", prospect_school: "침산초", prospect_grade: "초3", subject: "math" }),
      row({ id: "b", prospect_name: "박영희", prospect_school: "동평초", prospect_grade: "중2", subject: "math" }),
    ]);
    expect(p.blockers, "동일인 검증이 없으면 남의 상담이 합쳐진다").not.toEqual([]);
  });
});

describe("적대 검증 — 동일인 판정의 경계", () => {
  it("같은 학생에 연결돼 있으면 이름 표기가 달라도 막지 않는다(개명·접미사)", () => {
    const p = planMerge([
      row({ id: "a", student_id: "s1", prospect_name: "김나현", subject: "math" }),
      row({ id: "b", student_id: "s1", prospect_name: "김나현A", subject: "math" }),
    ]);
    expect(p.blockers).toEqual([]);
  });

  it("같은 학교의 다른 표기는 다른 사람이 아니다(일중 = 대구일중)", () => {
    const p = planMerge([
      row({ id: "a", prospect_name: "김나은", prospect_school: "일중", subject: "math" }),
      row({ id: "b", prospect_name: "김나은", prospect_school: "대구일중", subject: "math" }),
    ]);
    expect(p.blockers).toEqual([]);
  });

  it("이름은 같은데 학교가 다르면 동명이인으로 보고 막는다", () => {
    const p = planMerge([
      row({ id: "a", prospect_name: "김민수", prospect_school: "침산초", subject: "math" }),
      row({ id: "b", prospect_name: "김민수", prospect_school: "동평초", subject: "math" }),
    ]);
    expect(p.blockers.join()).toMatch(/학교가 서로 다른/);
  });

  it("급만 남은 잔해('초')는 다른 학교라는 근거가 못 된다", () => {
    const p = planMerge([
      row({ id: "a", prospect_name: "김효빈", prospect_school: "동평초", subject: "math" }),
      row({ id: "b", prospect_name: "김효빈", prospect_school: "초", subject: "math" }),
    ]);
    expect(p.blockers).toEqual([]);
  });
});

describe("적대 검증 — 이어붙인 순서는 엔진에 따라 흔들리면 안 된다", () => {
  it("같은 입력이면 항상 같은 결과", () => {
    const rows = [
      row({ id: "a", prospect_name: "김", parent_request: "짧은 기록" }),
      row({ id: "b", prospect_name: "김", parent_request: "훨씬 더 긴 별개의 기록입니다 아주 길게" }),
    ];
    const first = planMerge(rows).decisions.find((d) => d.key === "parent_request")!.proposed;
    for (let i = 0; i < 20; i += 1) {
      expect(planMerge(rows).decisions.find((d) => d.key === "parent_request")!.proposed).toBe(first);
    }
  });
});
