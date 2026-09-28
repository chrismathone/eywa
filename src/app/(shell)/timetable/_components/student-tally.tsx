import { tipProps } from "@/components/hover-tip/tip";

/**
 * 학생 집계 인라인 스탯(재원/신입/반이동/대기/퇴원) — 문법 ② 미니판(시간표는 세로 공간이 귀해
 * BigStat 카드 대신 인라인). 최상위 프레임에선 PageHeader 우측, 창(임베드)에선 헤더 줄을 통째로
 * 접고 툴바 우측에 이걸 넣는다(두 표면이 이 컴포넌트 하나를 공유 — 마크업 중복 금지).
 * 서버 컴포넌트(순수 마크업) — 이중 마운트돼도 상호작용이 없어 안전(#67 무관).
 *
 * 원장 2026-09-16(캡처 `194 재원 17 신입 13 전입 10 퇴원`): *"전입 -> 반이동으로 수정"* · *"한글 숫자 형식으로 바꿔줘
 * 현재 숫자 한글인걸"* · *"사이사이 구분선 약하게 세로줄"* — 라벨이 먼저, 숫자가 뒤(`재원 194`), 항목 사이는 표 열 구분선과
 * 같은 농도(`--line-faint`)의 세로줄. 🔴 **라벨만** 바꿨다 — 세는 값(`isTransferredIn`, 다른 반에서 옮겨 온 학생)은 그대로다.
 *
 * 원장 2026-09-28: *"이거 기준 적어놓자. 퇴원의 경우 한달만 잡히다보니 헷갈리는 사람이 많네"* → 항목마다 기준 카드
 * (`data-tip`). 🔴 **문구는 계산과 짝이다** — 창(30일)·상태 판정은 `getWeeklyScheduleWithStudents`
 * (`newCutoff`·`withdrawnFloor`)와 시간표 page의 집계가 정한다. 그쪽을 바꾸면 여기 `CRITERIA`도 같이 고칠 것.
 */

/** 항목별 기준 — 화면 카드에 그대로 보인다. */
const SCOPE = "보고 있는 과목·학년 필터 안에서, 그 주 기준일(이번 주는 오늘)로 셉니다. 여러 반을 듣는 학생도 한 번만 셉니다.";
const CRITERIA: Record<string, string> = {
  재원: "기준일에 수강 중인 학생",
  신입: "재원 중 최근 30일 안에 수강을 시작한 학생 · 반이동은 빼고 셉니다",
  반이동: "재원 중 최근 30일 안에 다른 반에서 옮겨 온 학생",
  대기: "시작일이 아직 안 온 학생(배정 예정)과 휴원 중인 학생",
  퇴원: "최근 30일 안에 이 과목 수업이 끝난 학생 · 다른 과목을 계속 다녀도 셉니다(퇴원관리의 퇴원 + 수강종료) · 반이동은 제외 · 퇴원 예정일이 아직 안 왔으면 재원으로 셉니다 · 30일이 지나면 숫자에서 빠집니다(이번 달 누적이 아닙니다)",
};
export function StudentTally({
  enrolled,
  newCount,
  transferCount,
  holdCount,
  withdrawnCount,
}: {
  enrolled: number;
  newCount: number;
  transferCount: number;
  holdCount: number;
  withdrawnCount: number;
}) {
  const items = [
    { n: enrolled, label: "재원", cls: "text-primary", always: true },
    { n: newCount, label: "신입", cls: "text-danger", always: false },
    { n: transferCount, label: "반이동", cls: "text-blue", always: false },
    { n: holdCount, label: "대기", cls: "text-amber", always: false },
    { n: withdrawnCount, label: "퇴원", cls: "text-text-faint", always: false },
  ];
  // 세로줄은 **항목마다 왼쪽 1px**로 긋고, 안쪽 줄을 (여백 12px + 선 1px)만큼 왼쪽으로 당겨 바깥이 잘라낸다 — 그래야
  // 좁은 창(툴바 안, 폰 폭)에서 두 줄로 접혀도 **줄마다 첫 항목**의 선이 가려지고 글자가 왼쪽에 붙는다.
  // (`divide-x`는 DOM 순서로만 선을 빼서, 접히면 윗줄 끝에 선이 매달리고 아랫줄 첫 항목이 들여써진다 — 리뷰 2026-09-16.)
  // `min-w-min` — `overflow-hidden`이 flex 자식의 최소 폭을 0으로 만들어 좁은 줄에서 글자가 잘리지 않게.
  return (
    <div className="min-w-min overflow-hidden" data-help="tt-tally">
      <div className="-mr-3 -ml-[13px] flex flex-wrap items-baseline gap-y-1 whitespace-nowrap">
        {items
          .filter((it) => it.always || it.n > 0)
          .map((it) => (
            <span
              key={it.label}
              className="border-line-faint mr-3 cursor-help border-l pl-3 text-sm"
              {...tipProps({ title: `${it.label} 기준`, lines: [CRITERIA[it.label], SCOPE] })}
            >
              <span className="text-text-dim">{it.label}</span>{" "}
              <b className={`num ${it.cls} text-lg font-bold`}>{it.n}</b>
            </span>
          ))}
      </div>
    </div>
  );
}
