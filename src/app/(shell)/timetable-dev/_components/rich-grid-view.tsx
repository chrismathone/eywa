import { SUBJECT_SOFT, type SubjectMaps } from "@/features/owner/subjects";
import {
  buildRichCardGroups,
  type GridSlot,
  type IntegrationGroupsConfig,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { TeacherNicknameMap } from "@/features/timetable/lib/teacher-label";
import { RichCardGroupBoard } from "./rich-card-group";
import { SearchedCell, VisibleClassCount } from "./search-context";

/**
 * 통합뷰 = ijw EnglishClassTab "반=열 리치 그리드" 이식. 시작 교시별 섹션마다:
 * 좌측 고정 라벨열(수업명/담임/강의실/교시/재원/대기/퇴원) + 반=열 카드(요일×교시 미니그리드 — 셀마다 강사/LAB).
 * 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션. 읽기전용(편집은 기본뷰). 과목칩=과목 전환.
 * 빌드는 서버(순수), 보드 렌더는 클라(DragScrollArea). 과목색은 SubjectMaps→plain 클래스로만 클라에 전달([[#61]]).
 *
 * 🔴 **섹션 머리글(그룹 이름·수업 수·'1시간 단위' 토글)은 안 그린다**(원장 2026-08-13 — *"그룹이름은
 *    전체 숨겨주고. 1시간 단위도 숨겨줘. 이건 그룹설정에서만 세팅가능하도록"*). 줄 이름은 원장이 배치를
 *    짜면서 쓰는 작업용 이름이지 보는 사람에게 필요한 정보가 아니었고, 머리글 한 줄(43px)이 섹션마다
 *    붙어 세로를 먹었다. '1시간 단위'는 **그룹 설정(배치 편집) 화면의 줄 머리글**로 옮겼다.
 * 🔴 섹션들은 **붙여서** 한 판으로 그린다(원장 2026-08-13 *"스프레드시트에서 다음 시트로 이어지는 것처럼"*)
 *    — 카드 사이엔 구분선만 둔다(아래 SECTION_DIVIDER).
 */
export function RichGridView({
  slots,
  subjectMaps,
  config,
  teacherColors,
  teacherNicknames,
  compactSections,
  customGroups,
}: {
  slots: GridSlot[];
  subjectMaps: SubjectMaps;
  config: PeriodsConfig;
  teacherColors: TeacherColorMap;
  /** 담임 줄 `한글이름(영어이름)` 표기(영어 시간표만) — page가 과목을 보고 넘긴다. */
  teacherNicknames?: TeacherNicknameMap;
  /** 커스텀 그룹(학원설정 과목별). 미지정이면 "N교시 시작" 자동 그룹. */
  customGroups?: IntegrationGroupsConfig | null;
  /**
   * 압축할 섹션(N교시 시작)의 sectionKey 집합 — 이 섹션만 '1시간 단위'로 교시 체계가 다른 반을 부그룹으로
   * 나눈다. **여기선 설정만 소비**하고 토글은 안 그린다(설정 지점 = 그룹 설정 화면).
   */
  compactSections: Set<number>;
}) {
  const groups = buildRichCardGroups(slots, config, compactSections, customGroups);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const subjectSoftClass = SUBJECT_SOFT[subjectMaps.colorOf(slots[0]?.subject ?? "")];

  return (
    // ⚠️ 자체 overflow-y-auto 금지 — 셸 스크롤과 중첩돼 우측 이단 스크롤바가 생긴다(2026-07-06).
    // 세로 스크롤은 바깥(셸) 하나만: 명단 섹션이 고정 행수(재원12·대기3·퇴원5)로 캡되어 그룹 높이가
    // 유계라, 그룹들이 자연 문서 흐름으로 쌓이고 넘침은 셸이 스크롤한다.
    // ⚠️ 아래 여백(pb-8) — 마지막 줄이 창 바닥에 딱 붙어 끝나 **끝까지 내려온 건지 알 수 없었다**
    //    (원장 2026-08-13 *"스크롤이 우측에 너무 안 보여서 끝까지 내려갔는지 헷갈림"*). 위(헤더 아래)와
    //    같은 정도의 숨 쉴 틈을 아래에도 둔다 — 여백 자체가 "여기가 끝"이라는 신호다.
    <div className="pb-8">
      <div className="text-text-faint mb-2 text-right text-[12px]">
        {/* 검색 중이면 "보이는 수/전체" — 카드 한 장만 남은 화면이 "42개 수업"이라 말하면 거짓말이 된다. */}
        읽기 전용 · <VisibleClassCount total={total} />개 수업 · 편집은 기본뷰
      </div>
      {/* 섹션 = 한 판(스프레드시트의 다음 시트처럼 이어 붙임). 카드 사이는 구분선만. */}
      <div className="bg-card shadow-card w-max max-w-full overflow-hidden rounded-2xl">
        {groups.map((g) => (
          // 라벨은 화면에서 뺐지만 aria-label로는 남긴다 — 보조기술엔 "몇 번째 줄"이 여전히 필요하다.
          // 학생 검색 — 걸린 반이 하나도 없는 줄은 통째로 안 그린다(라벨열만 남은 빈 줄 방지).
          <SearchedCell key={g.key} classIds={g.cards.map((c) => c.classId)}>
            <section aria-label={g.label} className={SECTION_DIVIDER}>
              <RichCardGroupBoard
                group={g}
                subjectSoftClass={subjectSoftClass}
                teacherColors={teacherColors}
                teacherNicknames={teacherNicknames}
              />
            </section>
          </SearchedCell>
        ))}
      </div>
    </div>
  );
}

/**
 * 줄과 줄 사이 구분선 — 머리글이 사라진 자리를 대신해 **여기서 다른 줄이 시작한다**만 말한다.
 * 격자선(1px)·카드 경계(2px)보다 굵어야 줄 경계로 읽히므로 3px(원장 2026-08-13 "적당한 굵기의 구분선만").
 *
 * ⚠️ 별도 `<div>`가 아니라 **섹션 자신의 위 테두리**다(2026-08-20) — 학생 검색이 앞 줄들을 통째로
 *    지우면 형제 div로 둔 선은 맨 위에 떠 있는 3px 막대로 남는다. `:not(:first-child)`는 **그려진**
 *    첫 섹션을 보므로 어느 줄이 남든 선이 알아서 맞는다.
 */
const SECTION_DIVIDER = "[&:not(:first-child)]:border-t-[3px] border-ink/45";
