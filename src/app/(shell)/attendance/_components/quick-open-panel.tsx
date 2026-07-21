import Link from "next/link";
import { ChevronRight } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import type { PillColor } from "@/components/atoms/pill";
import type { QuickOpenGroup } from "@/features/attendance/quick-open";
import { attHref, type RangeKey } from "./att-href";

export type QuickOpenClass = {
  id: string;
  className: string;
  subject: string | null;
  teacherName: string | null;
};

/**
 * 반 미선택 허브의 "바로 열기" 패널 — 과목별 섹션 + 과목당 상한.
 *
 * 옛 동작은 전체 목록을 `slice(0, 8)` 한 것이라, 반 이름 정렬(로마자 영어반 < 한글 수학반) 탓에
 * **수학반이 단 하나도 뜨지 않았다**. 그룹핑·상한 계산은 [`quick-open.ts`](src/features/attendance/quick-open.ts)
 * 순수 함수가 담당하고(Vitest로 고정) 여기선 그리기만 한다.
 *
 * ⚠️ 행 마크업(이름 13.5 bold / 강사 12.5 dim truncate / 우측 '열기' 알약)은 design-conventions의
 * Editorial 문법 ⑤ 레퍼런스로 지목된 구조다. 섹션은 이 행을 **감싸기만** 하는 additive 변경 — 재배치 금지.
 * ⚠️ 카드 안에 세로 스크롤을 넣지 말 것: `overflow-y-auto`가 overflow-x를 auto로 계산해 행의 `-mx-2`가
 * 가로 스크롤바를 만든다(창=iframe에선 스크롤바 2개 문제 #79로 이어짐).
 */
export function QuickOpenPanel({
  groups,
  limit,
  truncated,
  colorOf,
  month,
  range,
  teacherId,
  subjectId,
}: {
  groups: QuickOpenGroup<QuickOpenClass>[];
  limit: number;
  truncated: boolean;
  /** 과목 색 = 학원설정 단일 소스(buildSubjectMaps.colorOf). 로컬 과목 색 맵 신설 금지. */
  colorOf: (key: string) => PillColor;
  month: string;
  range: RangeKey;
  teacherId: string | null;
  subjectId: string | null;
}) {
  const total = groups.reduce((n, g) => n + g.total, 0);
  // 과목이 1개면(과목 필터 적용·단일과목 학원·강사뷰) 섹션 헤더가 툴바 과목칩과 중복이라 평면으로 뿌린다.
  const sectioned = groups.length > 1;

  return (
    <div className="bg-card shadow-card flex flex-col rounded-2xl p-5">
      <p className="text-foreground text-[14px] font-bold">
        바로 열기
        <span className="text-text-faint ml-1.5 font-medium">
          <span className="num">{total}</span>개 반
        </span>
      </p>

      {groups.length === 0 ? (
        // ⚠️ "필터를 바꿔보세요"라고 쓰지 말 것. 과목·강사 필터는 실제 반에서 도출된 값만 통과하므로
        // (page.tsx의 presentSubjects·teacherOptions 게이트) 필터 때문에 목록이 비는 상태는 만들 수 없다.
        // 여기 도달하는 유일한 경우 = 열 수 있는 활성 반이 0개(운영 중인 반이 없거나, 강사에게 담당 반 미배정).
        // 그 상태에선 드롭다운에 '전체'밖에 없어 바꿀 값이 없다 — 불가능한 조작을 시키는 안내가 된다.
        <p className="text-text-dim mt-3 text-[12.5px]">
          열 수 있는 반이 없습니다 — 운영 중인 반이 없거나 담당 반이 배정되지 않았습니다.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              {sectioned ? (
                <div className="flex items-center gap-2 pb-1">
                  <Pill color={colorOf(g.key)}>{g.label}</Pill>
                  {/* 숨긴 규모를 항상 노출 — 상한에 걸려 6개만 보여도 "수학 65개 반"이라 적힌다. */}
                  <span className="text-text-faint text-[11.5px] font-medium">
                    <span className="num">{g.total}</span>개 반
                  </span>
                  {/* 잘렸을 때만 드릴다운(안 잘렸으면 링크가 거짓 약속). 미지정 그룹은 과목 필터 값이
                      아니라 눌러도 무시되므로 링크를 걸지 않는다. */}
                  {g.total > limit && !g.unassigned ? (
                    <Link
                      href={attHref({ classId: null, month, range, teacherId, subjectId: g.key })}
                      aria-label={`${g.label} 반 더 보기`}
                      className="text-text-dim hover:text-foreground hover:bg-bg-soft ml-auto inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium transition"
                    >
                      더 보기
                      <ChevronRight className="size-3" />
                    </Link>
                  ) : null}
                </div>
              ) : null}

              <ul className="grid gap-x-2 sm:grid-cols-2">
                {g.classes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={attHref({ classId: c.id, month, range, teacherId, subjectId })}
                      className="hover:bg-bg-soft -mx-2 flex items-center gap-2.5 rounded-xl px-2 py-2 transition"
                    >
                      <span className="text-foreground shrink-0 text-[13.5px] font-bold">{c.className}</span>
                      <span className="text-text-dim min-w-0 flex-1 truncate text-[12.5px]">{c.teacherName ?? ""}</span>
                      <span className="bg-primary-soft text-primary shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-bold">
                        열기
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* mt-auto = 2열 카드 높이 균형 관용구(좌측 PhotoCard와 stretch). 문구는 정직하게:
          옛 "나머지 반은 필터로 좁혀서 선택하세요"는 과목을 골라도 다시 잘려 끝이 안 나는 안내였다. */}
      {truncated ? (
        <p className="text-text-faint mt-auto pt-2 text-[12px]">
          {sectioned ? "과목별 " : ""}앞 <span className="num">{limit}</span>개만 보여줍니다 — 찾는 반은 위 &lsquo;반&rsquo;
          목록에서 이름으로 검색하세요.
        </p>
      ) : null}
    </div>
  );
}
