import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ParentReportCard, type ParentReportCardProps } from "./parent-report-card";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { buildTrendPoints } from "../report-trend";
import type { ReportSettings } from "@/features/owner/settings-types";
import type { JjReportSnapshot } from "@/features/ijw/snapshot";

// 그림(인재원 결과지·학습 분석지)의 **자리**만 본다 — 그림 모양은 그 컴포넌트의 테스트 몫이라 글자 표식으로 바꿔 둔다.
vi.mock("@/features/ijw/components/jj-exam-sheet", () => ({
  JjExamSheet: ({ exam }: { exam: { deck: { name: string } } }) => `EXAM:${exam.deck.name}`,
}));
vi.mock("@/features/ijw/components/jj-study-sheet", () => ({
  JjStudySheet: ({ study }: { study: { from: string } }) => `STUDY:${study.from}`,
}));

/**
 * 학부모 보고서 카드 — **수학 출력 불변 + 영어 템플릿 모드**.
 *
 * 🔴 이 카드는 학부모에게 매일 나가는 수학 보고서(/r 공개 링크·ClassNote 게시 이미지·인쇄)의 원본이다.
 *    템플릿 모드(영어)를 더하면서 수학 카드가 **글자 하나라도** 바뀌면 안 된다 — 그래서 템플릿 모드 도입 **직전**
 *    카드의 정적 마크업 해시를 골든 값으로 박았다(2026-09-10, 원본 컴포넌트에서 실측).
 *    ⚠️ 카드 모양을 **의도적으로** 바꾸면 이 해시가 깨진다 — 그때는 테스트를 고치기 전에 "수학 학부모 카드가
 *       왜 바뀌는지"를 커밋 메시지에 적고 해시를 갱신한다(돈 계열 골든마스터와 같은 규약).
 *    ⚠️ 표시 토글은 기본값(DEFAULT_SETTINGS)에 기대지 않고 카드가 읽는 칸을 전부 명시한다 — 기본값이 바뀌어도
 *       이 테스트가 흔들리지 않게.
 */

const SETTINGS: ReportSettings = {
  ...DEFAULT_SETTINGS.report,
  title: "수업 보고서",
  showLogo: true,
  showAcademyName: true,
  showFooter: true,
  footerNote: "",
  showTextbook: true,
  showProgress: true,
  showDailyTest: true,
  showCheckTest: true,
  showHomework: true,
  showHomeworkToday: true,
  showAttitude: true,
  showParentNote: true,
  showTrendNote: true,
  showTrendGraph: true,
  showAttachments: true,
};

/** 모든 칸이 차 있는 수학 보고서 — 오늘 수업·평가·학습 추이·전달 내용·추세·첨부·바닥글이 전부 그려진다. */
const FULL: ParentReportCardProps = {
  report: {
    reportDate: "2026-09-10",
    teacherName: "박소선",
    textbook: "개념원리 중1-1",
    progress: "수학 1-1-1 소인수분해\n수학 1-1-2 최대공약수",
    dailyTest: "20문제 중 18개 맞음",
    checkTest: "10문제 중 9개 맞음",
    examInfo: null,
    homeworkScore: "90%",
    homeworkToday: "개념편 p10~16",
    attitude: "매우 좋음",
    notes: "원과 현을 무리 없이 따라왔습니다.",
    trendNote: "최근 3회 상승세입니다.",
    makeup: false,
    hasClass: true,
  },
  student: { name: "이윤건", school: "달성초", grade: "초2" },
  academyName: "인재원",
  logoSrc: "https://example.test/logo.png",
  settings: SETTINGS,
  attachments: [
    { path: "t/a.png", name: "a.png", url: "https://example.test/a.png" },
    { path: "t/b.pdf", name: "b.pdf", url: "https://example.test/b.pdf" },
  ],
  trend: buildTrendPoints(
    [
      { id: "r1", date: "2026-09-01", examInfo: "20문제 중 16개", homeworkScore: "100%" },
      { id: "r2", date: "2026-09-05", examInfo: "20문제 중 12개", homeworkScore: "80%" },
      { id: "r3", date: "2026-09-10", examInfo: "20문제 중 18개", homeworkScore: "90%" },
    ],
    "r3",
  ),
};

it.each([false, true])("학부모 보고서 이름에는 구분용 알파벳을 표시하지 않는다(templateMode=%s)", templateMode => {
  const student = { ...FULL.student!, name: "김민서G" };
  const html = renderToStaticMarkup(<ParentReportCard {...FULL} student={student} templateMode={templateMode} />);
  expect(html).toContain("김민서");
  expect(html).not.toContain("김민서G");
  expect(student.name).toBe("김민서G");
});

it("영상 과제가 있는 보고서만 오늘 과제 아래에 실제 제출 날짜를 표시한다", () => {
  const html = renderToStaticMarkup(<ParentReportCard {...FULL} report={{ ...FULL.report, reportDate: "2026-10-02", videoHomework: true }} />);
  // 언제까지 내나 — 올리기 사이트·멘트와 같은 문구(video-homework/due.ts, 원장 2026-10-15).
  expect(html).toContain("10/9 (금)까지");
  expect(html.indexOf("영상 숙제")).toBeGreaterThan(html.indexOf("오늘 과제"));
  expect(html).not.toContain("영상숙제 기한");
  expect(renderToStaticMarkup(<ParentReportCard {...FULL} />)).not.toContain("영상 숙제");
});

/** 빈 칸이 많은 보고서 — 레거시 합본 점수·보강·학생 없음·빈 전달 내용·바닥글 끔 분기. */
const SPARSE: ParentReportCardProps = {
  report: {
    reportDate: "2026-09-10",
    teacherName: null,
    textbook: null,
    progress: null,
    dailyTest: null,
    checkTest: null,
    examInfo: "4/5",
    homeworkScore: null,
    homeworkToday: null,
    attitude: null,
    notes: null,
    trendNote: null,
    makeup: true,
    hasClass: false,
  },
  student: null,
  academyName: "인재원",
  logoSrc: null,
  settings: { ...SETTINGS, showFooter: false, showTrendNote: false },
  attachments: [],
};

/** 템플릿 모드 도입 직전(2026-09-10) 원본 컴포넌트의 정적 마크업 SHA-256.
 *  2026-09-21 FULL 갱신 — 제품 개명(eywa→aywa)으로 아이콘 표식 속성 `data-eywa-icon`이 `data-aywa-icon`이 됐다(보이는 글자·모양 불변,
 *  마크업의 aywa를 eywa로 되돌리면 옛 해시 b2e6adcf…와 정확히 같다). SPARSE엔 아이콘이 없어 그대로다.
 *  2026-11-09 FULL 갱신 — 앱 기본색 차콜 전환(instrument-theme · `--primary` #153e75→#363c41)에 맞춰 성적 추이 그래프 시험 선 색만 바뀌었다
 *  (마크업의 #363c41을 #153e75로 되돌리면 옛 해시 7de0e398…와 정확히 같다 — 글자·구조 불변). */
const GOLDEN = {
  FULL: "5dea1d393981019d46b0199ad1e4ac8dac27567d61808c5e841566f540833b10",
  SPARSE: "954922ef759e90eed08e34fbce0e1a4ad9cdd5eeb5338fc4e4fb9d03473d5169",
};

const markup = (p: ParentReportCardProps) => renderToStaticMarkup(<ParentReportCard {...p} />);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("ParentReportCard — 수학(기본) 출력 불변", () => {
  it("🔴 templateMode를 안 넘기면 템플릿 모드 도입 전과 글자 하나 다르지 않다(골든 해시)", () => {
    expect(sha(markup(FULL))).toBe(GOLDEN.FULL);
    expect(sha(markup(SPARSE))).toBe(GOLDEN.SPARSE);
  });

  it("templateMode={false}도 안 넘긴 것과 같다", () => {
    expect(markup({ ...FULL, templateMode: false })).toBe(markup(FULL));
    expect(markup({ ...SPARSE, templateMode: false })).toBe(markup(SPARSE));
  });
});

describe("ParentReportCard — 템플릿 모드(영어)", () => {
  const EIE = [
    "안녕하세요 학부모님, 부원장입니다! 😊❤️",
    "",
    "📍 오늘의 진도",
    "부원장 선생님 수업 : Unit 1~3 핵심 내용 전체 리뷰",
    "",
    "💌 부원장 코멘트 (Feedback)",
    "서연이가 구문을 척척 찾아냈습니다.",
  ].join("\n");
  const english = (notes: string | null, over: Partial<ParentReportCardProps> = {}) =>
    markup({ ...FULL, report: { ...FULL.report, notes }, templateMode: true, ...over });

  it("조립된 글이 본문이다", () => {
    const html = english(EIE);
    expect(html).toContain("안녕하세요 학부모님, 부원장입니다! 😊❤️");
    expect(html).toContain("📍 오늘의 진도");
    expect(html).toContain("서연이가 구문을 척척 찾아냈습니다.");
  });

  it("오늘 수업·평가·학습 추이·학부모 전달 내용·학습 추세 칸을 그리지 않는다(같은 내용이 두 번 나가지 않게)", () => {
    const html = english(EIE);
    for (const title of ["오늘 수업", "평가", "학습 추이", "학부모 전달 내용", "학습 추세"]) {
      expect(html).not.toContain(`>${title}<`);
    }
    // 항목 칸의 값도 안 나간다 — 진도·점수·추세 문장.
    expect(html).not.toContain("소인수분해");
    expect(html).not.toContain("20문제 중 18개 맞음");
    expect(html).not.toContain("최근 3회 상승세입니다.");
    // 학습 추이 그래프(viewBox 660×200) — svg 요소 개수로 세면 첨부 받기 아이콘까지 걸린다.
    // ⚠️ 이 파일에 여는 꺾쇠+svg 글자를 적지 말 것 — 아이콘 가드(aywa-icon-mapping.test)가 인라인 SVG로 센다.
    expect(markup(FULL)).toContain('viewBox="0 0 660 200"'); // 수학에선 그려진다(아래 부정 검사의 짝)
    expect(html).not.toContain('viewBox="0 0 660 200"');
  });

  it("과목 이름을 받으면 제목이 과목 보고서(원장 2026-10-16)", () => {
    expect(markup({ ...FULL, report: { ...FULL.report, subjectLabel: "수학" } })).toContain("2026년 09월 10일 수학 보고서");
    expect(english(EIE, { report: { ...FULL.report, notes: EIE, subjectLabel: "영어" } })).toContain("2026년 09월 10일 영어 보고서");
  });

  it("머리·학생 정보·첨부·바닥글은 수학과 같다", () => {
    const html = english(EIE);
    expect(html).toContain("2026년 09월 10일 수업 보고서");
    expect(html).toContain(">학생 정보<");
    expect(html).toContain("이윤건");
    expect(html).toContain(">첨부<");
    expect(html).toContain("https://example.test/a.png");
    expect(html).toContain("인재원 · 2026년 09월 10일");
    expect(html).toContain("report-capture"); // 워커 캡처 선택자
  });

  it("'학부모 전달 내용' 토글을 꺼도 본문은 나간다(글이 곧 보고서)", () => {
    const html = english(EIE, { settings: { ...SETTINGS, showParentNote: false } });
    expect(html).toContain("📍 오늘의 진도");
  });

  it("글이 비면 기존 빈 문구를 그대로 보여 준다", () => {
    for (const empty of [null, "", "  \n  "]) {
      expect(english(empty)).toContain("작성된 보고 내용이 없습니다.");
    }
  });

  it("CRLF도 줄바꿈으로 읽는다", () => {
    const html = english("가\r\n나");
    expect(html).toContain("가\n나");
    expect(html).not.toContain("\r");
  });
});

describe("ParentReportCard — 그림 자리(인재원, 2026-09-11)", () => {
  const exam = (name: string) => ({
    student: { id: "jdw", name: "jdw", className: null },
    deck: { id: name, name, examType: "regular" },
    submittedAt: "2026-09-10T05:00:00.000Z",
    elapsedMs: 1000,
    total: 20,
    correct: 18,
    score: 90,
    classAvg: null,
    overallAvg: null,
    byPos: [],
    wrong: [],
  });
  const snap = (exams: string[], answers = 30): JjReportSnapshot => ({
    v: 1,
    date: "2026-09-10",
    ijwId: "jdw",
    fetchedAt: "2026-09-10T06:00:00.000Z",
    study: {
      student: { id: "jdw", name: "jdw", className: null },
      from: "2026-08-12",
      to: "2026-09-10",
      totals: { answers, correct: 20, accuracy: 67, studyMs: 60000, newWords: 3, activeDays: 4 },
      longTermWords: 10,
      seenWords: 40,
      daily: [],
      byDeck: [],
      byPos: [],
      weak: [],
      exams: [],
    },
    exams: exams.map(exam),
  });
  const BODY = "안녕하세요\n\n[시험결과지]\n\n💌 코멘트\n잘했어요\n\n[학습분석지]";
  const html = (jj: JjReportSnapshot | null, notes = BODY) =>
    markup({ ...FULL, report: { ...FULL.report, notes }, templateMode: true, jj });

  it("자리 줄 자리에 그림을 끼우고 앞뒤 글은 제자리", () => {
    const h = html(snap(["Unit 3"]));
    expect(h).toContain("EXAM:Unit 3");
    expect(h).toContain("STUDY:2026-08-12");
    expect(h.indexOf("안녕하세요")).toBeLessThan(h.indexOf("EXAM:Unit 3"));
    expect(h.indexOf("EXAM:Unit 3")).toBeLessThan(h.indexOf("잘했어요"));
    expect(h.indexOf("잘했어요")).toBeLessThan(h.indexOf("STUDY:"));
  });

  it("영어 항목 보고서(2026-10-26)도 수학 표로 그리고 '인재원 결과지' 항목 안에 그림을 끼운다", () => {
    const sheet = "■ 진도\nUnit 3\n\n■ 오늘의 수업\n잘했어요\n\n■ 인재원 결과지\n[시험결과지]\n[학습분석지]\n\n■ 사랑의 한마디\n최고!";
    const h = html(snap(["Unit 3"]), sheet);
    expect(h).toContain("EXAM:Unit 3");
    expect(h).toContain("STUDY:2026-08-12");
    expect(h).not.toContain("[시험결과지]");
    expect(h).not.toContain("■");
    expect(h.indexOf("잘했어요")).toBeLessThan(h.indexOf("EXAM:Unit 3"));
    expect(h.indexOf("STUDY:")).toBeLessThan(h.indexOf("최고!"));
  });

  it("🔴 자리 표식 글자는 학부모에게 나가지 않는다 — 자료가 없어도", () => {
    for (const jj of [snap(["Unit 3"]), null]) {
      const h = html(jj);
      expect(h).not.toContain("[시험결과지]");
      expect(h).not.toContain("[학습분석지]");
      expect(h).toContain("잘했어요");
    }
    expect(html(null)).not.toContain("EXAM:");
  });

  it("그날 시험이 여럿이면 한 장씩 · 학습 기록이 없으면 학습 분석지를 안 그린다", () => {
    const h = html(snap(["Unit 3", "Unit 4"], 0));
    expect(h).toContain("EXAM:Unit 3");
    expect(h).toContain("EXAM:Unit 4");
    expect(h).not.toContain("STUDY:");
  });

  it("그림 자리만 있고 그릴 게 없으면 빈 문구", () => {
    expect(html(null, "[시험결과지]")).toContain("작성된 보고 내용이 없습니다.");
  });

  it("그림 자리가 없는 글은 자료를 넘겨도 예전과 같다(한 칸 그대로)", () => {
    const plain = { ...FULL, report: { ...FULL.report, notes: "가\n나" }, templateMode: true };
    expect(markup({ ...plain, jj: snap(["Unit 3"]) })).toBe(markup(plain));
  });
});

describe("ParentReportCard — 글 속 첨부 자리(사진·PDF, 2026-09-11)", () => {
  const ATT = [
    { path: "t/photo.png", name: "시험지.png", url: "https://example.test/photo.png" },
    { path: "t/sheet.pdf", name: "문제지.pdf", url: "https://example.test/sheet.pdf" },
    { path: "t/other.png", name: "other.png", url: "https://example.test/other.png" },
  ];
  const BODY = "첫 문단입니다\n[첨부: 시험지.png]\n진도 설명입니다\n[첨부: 문제지.pdf]\n\n💌 코멘트";
  const html = (over: Partial<ParentReportCardProps> = {}, notes = BODY) =>
    markup({ ...FULL, report: { ...FULL.report, notes }, attachments: ATT, templateMode: true, ...over });
  const count = (h: string, s: string) => h.split(s).length - 1;
  // ⚠️ 그림은 `src="…"`로 센다 — React 19 정적 렌더가 그림마다 머리에 preload 링크(href)를 따로 붙여 주소가 두 번 나온다.
  const img = (u: string) => `src="${u}"`;
  const PHOTO = img("https://example.test/photo.png");
  const PDF = 'href="https://example.test/sheet.pdf"';

  it("자리 줄 자리에 사진·PDF가 서고, 아래 '첨부' 칸엔 글 속에 없는 것만 남는다", () => {
    const h = html();
    expect(h.indexOf("첫 문단입니다")).toBeLessThan(h.indexOf(PHOTO));
    expect(h.indexOf(PHOTO)).toBeLessThan(h.indexOf("진도 설명입니다"));
    expect(h.indexOf("진도 설명입니다")).toBeLessThan(h.indexOf(PDF));
    expect(count(h, PHOTO)).toBe(1); // 글 속 한 번 — 아래 칸에서 빠졌다
    expect(count(h, PDF)).toBe(1);
    expect(h.indexOf(">첨부<")).toBeLessThan(h.indexOf(img("https://example.test/other.png")));
    expect(h).not.toContain("[첨부:");
  });

  it("글 속 자리가 전부면 아래 '첨부' 칸이 없다", () => {
    expect(html({ attachments: ATT.slice(0, 2) })).not.toContain(">첨부<");
  });

  it("🔴 학원설정 첨부 표시가 꺼지면 글 속 자리도 비운다 · 못 찾은 이름은 아무것도 안 그린다", () => {
    const off = html({ settings: { ...SETTINGS, showAttachments: false } });
    expect(off).not.toContain("example.test/photo.png");
    expect(off).not.toContain("[첨부:");
    expect(off).toContain("진도 설명입니다");
    const missing = html({}, "첫 문단입니다\n[첨부: 없는파일.jpg]\n둘째 문단입니다");
    expect(missing).not.toContain("없는파일");
    expect(missing).toContain("둘째 문단입니다");
  });

  it("같은 이름 자리가 두 번이면 한 번만 그린다 · 수학(템플릿 모드 아님)은 자리 줄을 읽지 않는다", () => {
    expect(count(html({}, "가\n[첨부: 시험지.png]\n나\n[첨부: 시험지.png]"), PHOTO)).toBe(1);
    const math = markup({ ...FULL, report: { ...FULL.report, notes: BODY }, attachments: ATT });
    expect(count(math, PHOTO)).toBe(1); // 아래 '첨부' 칸 그대로
    expect(math).toContain("[첨부: 시험지.png]"); // 수학 '학부모 전달 내용'은 글자 그대로(자리 줄을 해석하지 않는다)
  });
});

describe("호스트 배선 — /r·인쇄", () => {
  const ROOT = process.cwd();
  const R_PAGE = path.join(ROOT, "src", "app", "(share)", "r", "[token]", "page.tsx");
  const PRINT_PAGE = path.join(ROOT, "src", "app", "(print)", "lesson_reports", "[id]", "print", "page.tsx");

  it("둘 다 과목으로 템플릿 모드를 켠다(같은 판정 = 강사 미리보기 = 실제 발송물)", () => {
    for (const f of [R_PAGE, PRINT_PAGE]) {
      expect(readFileSync(f, "utf8"), f).toContain('templateMode={report.subject === "english"}');
    }
  });

  it("🔴 SELECT에 새 컬럼을 끼우지 않았다(없는 컬럼 하나가 /r 전체를 죽인다, #95)", () => {
    expect(readFileSync(R_PAGE, "utf8")).toContain(
      '"id, tenant_id, student_id, class_id, subject, report_date, revoked_at, textbook, progress, exam_info, homework_score, homework_today, teacher_name, notes, trend_note, daily_test, check_test, attitude, attachments, makeup"',
    );
    expect(readFileSync(PRINT_PAGE, "utf8")).toContain(
      '"id, student_id, class_id, subject, report_date, textbook, progress, exam_info, homework_score, homework_today, teacher_name, notes, trend_note, daily_test, check_test, attitude, attachments, makeup"',
    );
  });
});
