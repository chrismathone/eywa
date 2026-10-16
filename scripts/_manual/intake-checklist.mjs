// 학원 도입 자료 안내(계약 별첨 1) PDF 생성기 — 원장 2026-09-29 *"에이와-학원도입-자료체크리스트.pdf 고도화.
// 실제로 다른 지점에서 업로드용 엑셀 양식을 다운로드 받고 업로드를 통해 모든 데이터 업로드 가능하게"*.
//
// 옛 판(ReportLab, 09-28)은 "파일을 제출하면 우리가 옮긴다"였다. 이 판은 **학원이 직접** 학원 설정 › 데이터 가져오기
// (또는 각 탭의 '엑셀로 넣기')에서 서식을 받아 올리는 흐름을 적는다. 표의 시트·열·매칭 키는
// src/features/excel-import/importers/*.ts 의 서식과 같아야 한다 — 서식을 바꾸면 여기 ITEMS도 함께 고칠 것.
//
// 실행: node scripts/_manual/intake-checklist.mjs [출력경로]
//   기본 출력 = docs/manual/에이와-학원도입-자료체크리스트.pdf (git에 올리지 않는 산출물 — README 참조)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const OUT = process.argv[2] ?? path.join("docs", "manual", "에이와-학원도입-자료체크리스트.pdf");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 직접 올리는 자료 — 도입 순서. [자료, 여는 곳, 시트, 필수 열, 그 밖의 열, 같은 것 판단] */
export const ITEMS = [
  ["직원·계정", "직원관리", "직원", "이메일 · 이름", "역할 · 연락처 · 직급 · 근무부서 · 근무형태 · 담당과목 · 입사일 · 영어 닉네임 · 메모", "로그인 이메일"],
  ["강의실", "학원 설정 › 운영 체계", "강의실", "강의실", "정원", "강의실 이름"],
  ["원생 명단", "원생목록", "원생", "이름", "원생번호 · 영문이름 · 학교 · 학년 · 성별 · 생년월일 · 상태 · 원생연락처 · 보호자명·관계·연락처 · 주소 · 이메일 · 등록일 · 퇴원일 · 메모", "원생번호 → 없으면 이름+학교+학년"],
  ["반 목록", "수업목록", "반", "반이름 · 과목", "담당강사 · 강의실 · 운영 · 특강 · 종강일 · 메모", "반이름 + 과목"],
  ["정기 시간표", "수업목록", "시간표", "반이름 · 요일 · 시작 · 종료", "과목 · 교시 · 강사 · 강의실 · 적용시작일", "반 + 요일 + 시작 시각"],
  ["원생별 반 배정", "수업목록", "반배정", "원생이름 · 반이름 · 수강시작일", "원생번호 · 학교 · 학년 · 과목 · 수강종료일 · 등원요일 · 휴원", "원생 + 반"],
  ["신규 문의·등록상담", "신규 콜&상담", "상담", "상담일 · 학생이름", "시각 · 학교 · 학년 · 연락처 · 보호자 · 상담경로 · 과목 · 담당자 · 상담내용 · 진행상태 · 등록여부 · 후속일 · 결제금액", "상담일 + 학생 + 보호자 연락처"],
  ["재원생 상담", "원생상담", "상담", "이름 · 상담일 · 상담내용", "원생번호 · 학교 · 학년 · 시각 · 상담자 · 대상 · 분류 · 과목 · 조치 · 후속일 · 후속완료", "원생 + 상담일 + 내용 앞부분"],
  ["출결", "출석부", "출결", "이름 · 반 · 수업일 · 출결", "원생번호 · 학교 · 학년 · 과목 · 시작시각 · 시수 · 사유/메모", "원생 + 반 + 수업일(+ 시작시각)"],
  ["전환일 수납 현황", "수납관리 › 수납", "수납", "이름 · 청구월 · 청구액", "원생번호 · 학교 · 학년 · 구분 · 할인 · 납부액 · 납부일 · 결제수단 · 납부기한 · 메모", "원생 + 청구월"],
  ["비용·지출", "수납관리 › 지출", "지출", "지출일 · 항목 · 금액", "분류 · 거래처 · 정산방법 · 메모", "지출일 + 항목 + 금액"],
  ["교재·차수", "교재목록", "교재 · 차수", "교재이름 (차수 시트: 교재이름 · 차수번호)", "과목 · 구분 · 페이지/시간 · 차수 / 진도 · 과제", "과목 + 교재이름"],
  ["학원 일정·휴원", "캘린더", "일정", "시작일 · 제목", "종료일 · 종일 · 시작·종료시각 · 태그 · 색 · 메모", "시작일 + 제목"],
  ["셔틀 정류장·승하차", "셔틀", "정류장 · 승하차", "정류장 (승하차: 원생이름 · 차량 · 회차 · 정류장 · 승하차 · 요일)", "주소 · 위도 · 경도 · 도착반경 · 메모 / 학교 · 학년 · 시즌", "정류장 이름 / 원생 + 정류장 + 승하차"],
];

/** 엑셀로 옮기지 않는 자료 — 화면에서 정하거나 원본으로 보관. [자료, 방법] */
export const MANUAL = [
  ["학원 기본정보·로고·직인", "학원 설정 › 프로필·브랜드에서 직접 입력·업로드합니다."],
  ["운영 설정(과목·학년·교시·직급·학기)", "학원 설정 › 운영 체계·과목 운영에서 먼저 정합니다. 엑셀의 과목·학년·직급 칸은 이 설정의 이름으로 적어야 합니다."],
  ["수강료 기준표", "학원 설정 › 수납·청구와 수납관리 › 수강료 계산기에서 등록합니다."],
  ["성적·레벨테스트", "성적관리 화면의 [엑셀]로 반·시험별 서식을 받아 올립니다(시험 격자가 먼저 있어야 합니다)."],
  ["자산·재고", "재고관리 화면의 [엑셀]로 올립니다(자산·소모품 시트)."],
  ["계약서·동의서·상담 녹음·영수증", "원본 파일 그대로 보관합니다. 학원 자료실(서식 저장소)·원생 상담 첨부로 필요한 것만 올립니다."],
  ["직원 급여·계약 조건·주민번호·계좌", "엑셀로 올리지 않습니다(민감 정보). 직원관리 화면에서 권한 있는 사람이 직접 입력합니다."],
  ["보강 기록", "출석부 화면에서 결석과 연결해 잡습니다(엑셀 출결에서는 보강을 받지 않습니다)."],
  ["과거 발송·결제 시스템 상태", "새로 연결하거나 원본 증빙으로 보관합니다(발송 이력은 옮기지 않습니다)."],
];

const CSS = `
@page { size: A4; margin: 11mm 13mm 13mm; }
* { box-sizing: border-box; }
body { font-family: Pretendard, "Malgun Gothic", sans-serif; color:#121212; font-size:9.3pt; line-height:1.5; word-break:keep-all; margin:0; }
h1 { font-size:19pt; margin:0 0 4px; color:#153e75; letter-spacing:-.02em; }
h2 { font-size:12pt; margin:12px 0 5px; color:#153e75; break-after:avoid; }
.lead { margin:0 0 8px; }
.box { background:#eef3fb; border:1px solid #cfdbef; border-radius:6px; padding:8px 12px; margin:8px 0; }
.warn { background:#fff8e6; border-color:#f1d38a; }
ol.steps { margin:4px 0 0; padding-left:18px; } ol.steps li { margin:2px 0; }
table { width:100%; border-collapse:collapse; font-size:8.6pt; }
th { background:#153e75; color:#fff; text-align:left; padding:5px 6px; font-weight:700; }
td { border-bottom:1px solid #dde2ea; padding:4px 6px; vertical-align:top; }
tr { break-inside:avoid; }
td.n { text-align:center; color:#153e75; font-weight:800; width:22px; }
td.k { white-space:nowrap; font-weight:700; }
.req { color:#b3540b; font-weight:700; }
.dim { color:#555; }
.check td:first-child { width:18px; }
`;

function html() {
  const rows = ITEMS.map(
    ([name, where, sheet, req, opt, key], i) => `<tr>
      <td class="n">${i + 1}</td>
      <td class="k">${esc(name)}<div class="dim" style="font-weight:400">${esc(where)}</div></td>
      <td>${esc(sheet)}</td>
      <td><span class="req">${esc(req)}</span><div class="dim">${esc(opt)}</div></td>
      <td>${esc(key)}</td>
    </tr>`,
  ).join("");
  const manual = MANUAL.map(([a, b]) => `<tr><td class="k">${esc(a)}</td><td>${esc(b)}</td></tr>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <h1>별첨 1 | 학원 자료 이전 안내</h1>
  <p class="lead">기존 시스템의 자료를 <b>학원이 직접</b> 에이와로 옮깁니다. 자료마다 에이와가 주는 엑셀 서식을 내려받아 채운 뒤 올리면,
  미리보기를 확인하고 [반영]을 눌러 그대로 들어갑니다. 따로 파일을 보내거나 담당자가 옮길 때까지 기다리지 않아도 됩니다.</p>

  <div class="box"><b>올리는 방법</b> — 학원 설정 › <b>데이터 가져오기</b>(아래 표의 순서대로 모여 있습니다) 또는 각 화면의 <b>[엑셀로 넣기]</b>
    <ol class="steps">
      <li><b>서식 내려받기</b> — 지금 들어 있는 자료가 담긴 파일이 내려옵니다. 주황 칸(*)이 필수 열이고, 열 설명은 ‘안내’ 시트에 있습니다.</li>
      <li><b>채우기</b> — 기존 시스템에서 내보낸 표를 서식의 열 제목에 맞춰 붙여 넣습니다. 열 순서는 달라도 되고 ‘성명’·‘학부모연락처’ 같은 흔한 다른 제목도 알아봅니다.</li>
      <li><b>반영 방식 고르기</b> — <b>추가</b> = 이미 있는 것은 건너뛰고 새 것만 / <b>덮어쓰기</b> = 이미 있는 것은 파일 값으로 바꾸고 새 것도 넣기(빈 칸은 지우지 않습니다).</li>
      <li><b>올리기 → 미리보기</b> — 줄마다 추가·갱신·건너뜀이 보입니다. 이때는 아직 아무것도 바뀌지 않습니다.</li>
      <li><b>오류 고치기</b> — 서식이 틀리면 <b>시트 · 행 · 열 · 적은 값 · 문제</b>를 표로 보여 줍니다. [오류 칸 표시 파일 받기]를 누르면 틀린 칸이 빨갛게 칠해지고
        메모가 달린 파일(맨 앞 ‘오류목록’ 시트)이 내려옵니다. 검사에서 오류가 하나라도 나오면 아무것도 들어가지 않습니다(반영 도중 멈추면 같은 파일을 같은 방식으로 다시 올려 나머지를 넣습니다).</li>
      <li><b>[반영]</b> — 들어간 내용은 감사로그에 남습니다.</li>
    </ol>
  </div>

  <h2>1. 엑셀로 직접 올리는 자료 (이 순서대로)</h2>
  <p class="dim" style="margin:0 0 6px">앞 단계가 있어야 뒤 단계가 연결됩니다 — 반 배정은 원생과 반이, 출결은 반 배정이, 셔틀 승하차는 셔틀 편성(차량·회차·노선)이 먼저 있어야 합니다. 없는 원생·반·직원 이름을 적으면 그 칸이 오류로 표시됩니다.</p>
  <table>
    <thead><tr><th></th><th>자료 · 여는 곳</th><th>시트</th><th>필수 열 <span style="font-weight:400">/ 그 밖의 열</span></th><th>같은 것 판단(매칭 키)</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="box warn"><b>적는 요령</b> — 날짜 <b>2026-09-01</b> · 시각 <b>14:30</b> · 전화 <b>010-1234-5678</b> · 예/아니오 칸은 <b>예·아니오</b>.
    과목·학년·직급은 학원 설정에 등록한 이름 그대로, 원생·반·직원은 에이와에 있는 이름 그대로 적습니다.
    같은 이름이 둘이면 학교·학년(원생)이나 과목(반)·이메일(직원)을 더 적어 한 명으로 좁혀 주세요.
    기존 시스템의 <b>원생번호</b>를 원생 서식의 ‘원생번호’ 열에 옮겨 두면 이후 상담·출결·수납 서식에서도 번호로 찾습니다.
    <b>주민등록번호 · 전체 카드번호 · 계정 비밀번호는 적지 않습니다.</b></div>

  <h2>2. 엑셀로 옮기지 않는 자료</h2>
  <table><thead><tr><th>자료</th><th>방법</th></tr></thead><tbody>${manual}</tbody></table>

  <h2>3. 옮긴 뒤 확인</h2>
  <p class="dim" style="margin:0 0 6px">기존 시스템의 같은 날짜 숫자와 에이와 화면의 숫자를 비교합니다. 다르면 해당 서식을 다시 받아(지금 자료가 담겨 있습니다) 빠진 줄만 ‘추가’로 올리면 됩니다.</p>
  <table class="check"><thead><tr><th></th><th>항목</th><th>에이와에서 보는 곳</th></tr></thead><tbody>
    <tr><td>☐</td><td>재원 · 휴원 · 예비 · 퇴원 원생 수</td><td>원생목록 상태 필터</td></tr>
    <tr><td>☐</td><td>운영 중인 반 수 · 반별 인원</td><td>수업목록</td></tr>
    <tr><td>☐</td><td>현재 수강(반 배정) 건수 · 요일별 시간표</td><td>수업목록 · 시간표</td></tr>
    <tr><td>☐</td><td>직원 수 · 역할</td><td>직원관리</td></tr>
    <tr><td>☐</td><td>해당 월 청구·납부 합계 · 미납 건수와 합계</td><td>수납관리</td></tr>
  </tbody></table>
  </body></html>`;
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.setContent(html(), { waitUntil: "load" });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({
    path: OUT,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;margin:0 13mm;font-size:7pt;color:#777;display:flex;justify-content:space-between;font-family:Malgun Gothic,sans-serif">' +
      '<span>AYWA · 학원 자료 이전 안내 · 계약 첨부용</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  console.log("wrote", OUT);
} finally {
  await browser.close();
}
