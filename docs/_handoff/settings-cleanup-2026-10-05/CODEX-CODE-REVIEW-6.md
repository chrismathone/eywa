# 학원 설정 3단계 리뷰 6

2026-10-06 · 브랜치 커밋 대상만 검토. 차단·중요 0건, 경미 2건. main 반영은 PLAN의 원장 화면 확인 조건을 따른다.

## 새 발견 사항

| 번호 | 심각도 | file:line | 구체적 실행 경로 | 수정 제안 |
| --- | --- | --- | --- | --- |
| N1 | 경미 | `src/features/owner/tab-rows.ts:45`, `src/app/(shell)/owner/_components/owner-tab-bar.tsx:14`, `src/components/face-tabs.tsx:105` | 위임 계정이 숨긴 감사로그 면에 직접 온다. 본문은 감사 안내인데 ‘관리’ 범주 링크는 첫 보이는 면인 팝업 공지 주소다. 그 링크에 `aria-current="page"`가 붙어 다른 주소를 현재 페이지로 알린다. 일반 경우에는 범주·면 링크가 같은 현재 주소라 두 nav의 표시가 맞고, 이 예외만 어긋난다. 새 테스트도 이 결과를 기대한다(`owner-tab-bar.test.tsx:71`). | 범주 줄은 현재 **범주**임을 나타내는 aria-current 값으로 구분하거나, 링크 주소가 현재 면과 다른 경우 page 표식을 붙이지 않는다. 면 줄의 현재 페이지 표시는 유지한다. |
| N2 | 경미 | `src/features/help/manuals/owner.ts:10`, `src/features/owner/tab-rows.ts:37` | 개별 설정만 맡아 보이는 면이 5개 이하인 계정은 한 줄인데, 새 도움말 요약은 설정 위쪽에서도 묶음을 고르면 그 아래 면 줄이 선다고 예외 없이 설명한다. | ‘면이 많을 때’ 또는 ‘5개 이하이면 한 줄’ 예외를 짧게 덧붙인다. |

## 확인한 실행 경로

- **권한·주소**: 종전 facesFor × allowedTabs 필터가 그대로이고 범주 주소는 그 목록의 실제 면에서만 고른다. requireAccess·본문·fieldset·SELF_GATED_TABS는 diff에서 바뀌지 않았다. 주소/권한 키/창 타이틀·metadata/OWNER_TABS 변경도 없다. `owner/page.tsx:57`, `:130`, `:220`, `tab-rows.ts:43`(각각 `src/app/(shell)/owner/page.tsx`, `src/features/owner/tab-rows.ts`).
- **경계**: 0~5면은 flat, 6면부터 category다. 11면 위임도 category이고 일반판 기능은 권한·화면에 들어간다. category에서 active가 목록에 없으면 현재 범주의 보이는 첫 면으로, 현재 범주가 비면 해당 칸·면 줄 없이 처리한다. 정렬하지 않은 visible을 직접 넣으면 범주는 정의 순서, 면은 입력 순서를 따른다. 페이지가 원래 목록 순서를 보장하므로 실제 순서 회귀는 없다. `src/features/owner/tab-rows.ts:33`, `:37`, `:40`, `:45`, `:52`.
- **공용 회귀·링크**: customLabels 기본값 true의 식은 종전과 같고 false는 범주 줄만 사용한다. 기존 수납·시트·보고서 등 소비처에는 새 동작을 적용하지 않는다. 두 줄 모두 기존 Link/replace/embed 처리여서 이 변경이 미저장 입력 정책을 바꾸지 않는다. `src/components/face-tabs.tsx:33`, `:96`, `:103`, `src/app/(shell)/owner/_components/owner-tab-bar.tsx:14`.
- **테스트·문서**: 순수 함수 테스트가 5/6 문턱·빈 범주·숨긴 active·일반판·모든 면 주소를, 실제 컴포넌트 테스트가 두 nav·embed·메뉴 행에 의한 범주명 교체 방지를 검사한다. customLabels를 되돌리면 저장 행 때문에 범주가 면 이름으로 바뀌어 해당 단언과 맞지 않는다. 페이지 배선 두 검사는 문자열 단언이다. 지정에 따라 **테스트 미실행**; 조정자의 71개 통과·변이·브라우저 실측은 독립 재확인하지 않았다. `src/features/owner/tab-rows.test.ts:69`, `:101`, `src/app/(shell)/owner/_components/owner-tab-bar.test.tsx:46`, `:58`, `:97`. 결정 문서의 ‘현재 범주 재클릭은 현재 면’에는 숨긴 active일 때 첫 보이는 면으로 간다는 예외를 덧붙이면 정확하다(`docs/decisions/settings-wiring.md:54`).

판정: 커밋 가능
