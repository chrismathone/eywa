# 학원 설정 정리 적대적 코드 리뷰 4b

검토일: 2026-10-06. 범위: 리뷰 4의 경미 C1·C2 수리 및 그 수리로 바뀐 테스트·PLAN §7 마지막 줄. 다른 확정 항목은 다시 검토하지 않았다. 소스 수정 없음.

## C1·C2 판정

| 항목 | 판정 | 근거(file:line) |
| --- | --- | --- |
| C1 — 안내뿐인 역할·권한 면보다 사용 가능한 면으로 fallback | 닫힘 | `isNoticeOnlyFace`는 `permissions && systemRole !== "master"`이며, 본문의 `isMaster = viewer.systemRole === "master"` 조건과 일치한다. `isMasterLevel`이 참인 관리자 역할도 안내뿐인 면으로 분류한다. 후보를 기존 목록 순서로 거른 뒤 첫 사용 가능 후보를 고르고, 그런 후보가 없을 때만 첫 안내 후보를 고른다. 요청한 면의 메뉴 권한이 있으면 여전히 null이므로 직접 요청·탭 표시 정책은 바뀌지 않았다. `src/features/owner/face-access.ts:42`, `src/features/owner/face-access.ts:52`, `src/app/(shell)/owner/page.tsx:143`, `src/app/(shell)/owner/page.tsx:269`. |
| C2 — 별도 아이콘 표가 기존 그림 가드에서 빠짐 | 닫힘 | 표의 15개 값이 `{ icon: … }`이고, 파생 버튼은 `.icon`을 꺼내므로 실제 목적지의 icon은 계속 문자열이다. 직접 문자열 7줄은 모두 기존 전체 파일 추출식 `/icon:\s*"(\w+)"/g`와 줄별 추출식 `/icon:\s*"(\w+)"/`에 잡힌다. 새 테스트는 표의 행 수·각 행 모양·문자열 추출 결과를 검사하고, 실제 파생 버튼의 중복도 별도로 검사한다. `src/lib/menu-hub.ts:227`, `src/lib/menu-hub.ts:269`, `src/components/icons/menu-glyph.test.ts:50`, `src/components/icons/menu-glyph.test.ts:93`, `src/features/owner/tabs.test.ts:90`, `src/features/owner/tabs.test.ts:97`. |

## 새 발견 사항

없음. 차단 0건, 중요 0건, 경미 0건.

## 반증 결과와 테스트 실효성

- **C1의 원래 입력**: `owner`와 `navigation_settings`만 받은 관리자 역할 계정이 프로필로 요청하면 역할·권한을 건너뛰고 메뉴 구성으로 간다. `owner`만 있으면 전용 면과 역할·권한 안내를 건너뛰고 데이터 정리로 간다. 운영자 표식이 있어도 실제 역할이 관리자이면 역할·권한을 건너뛰며, 현재 후보 순서에서 쓸 수 있는 대시보드를 고른다. 세 경우 모두 실제 순수 함수 호출의 목적지 키를 단언한다. `src/features/owner/face-access.test.ts:85`, `src/features/owner/face-access.test.ts:95`, `src/features/owner/face-access.test.ts:100`.
- **후보 순서**: filter와 find는 목록 순서를 유지한다. 안내 면을 뒤로 미루는 것 외에 사용 가능 후보끼리의 우선순위를 바꾸지 않는다. 먼저 받은 개별 설정 면이 있는 경우의 기존 순서 검사도 유지된다. `src/features/owner/face-access.ts:54`, `src/features/owner/face-access.test.ts:42`.
- **안내 후보만 있는 경우**: 구현은 사용 가능 후보가 없으면 `candidates[0]`, 후보 자체가 없으면 null을 돌려준다. 다만 현재 목록에서 역할·권한이 읽기 후보가 되면 같은 `owner` 키의 데이터 정리·가져오기 중 적어도 하나도 후보가 된다. 둘은 일반판/전용 조건이 없고, 요청 면 하나를 빼더라도 나머지 하나가 남는다. 따라서 현재 목록·권한 키 계약으로는 ‘안내뿐인 역할·권한 하나만 후보’인 입력을 만들 수 없다. 이 분기 자체를 단독 실행한 테스트는 **미확인**이며, 현재 도달 불가능한 방어 분기로 판단한다. `src/features/owner/face-access.ts:15`, `src/features/owner/face-access.ts:55`, `src/features/owner/tabs.ts:76`, `src/features/owner/tabs.ts:88`, `src/features/owner/tabs.ts:91`, `src/lib/settings-role-catalog.ts:46`.
- **자기 주소·반복 redirect**: 자신을 제외하고 읽기 권한을 만족한 후보만 고르는 조건을 유지한다. 도착 요청은 같은 메뉴 권한을 만족하므로 함수의 첫 줄에서 null이 되고 기존 requireAccess를 지난다. 안내 후보를 선택하는 방어 분기도 이 조건을 벗어나지 않는다. 직접 권한이 있는 전용 면 요청을 남기는 테스트, 후보 없음·자기 면 제외 테스트도 통과했다. 권한이 요청 사이에 바뀌지 않는 전제에서 새 반복 경로는 없다. `src/features/owner/face-access.ts:53`, `src/features/owner/face-access.ts:54`, `src/app/(shell)/owner/page.tsx:124`, `src/app/(shell)/owner/page.tsx:135`, `src/features/owner/face-access.test.ts:66`, `src/features/owner/face-access.test.ts:71`, `src/features/owner/face-access.test.ts:120`.
- **그림 존재 검사**: 표의 직접 문자열은 `tag, key, sparkle, eraser, sync, history, sync` 순서로 추출된다. 전체 파일을 읽는 기존 가드는 이 이름을 used에 넣고 실제 그림 등록 목록과 비교한다. `MENU_ICON.x` 참조의 그림은 기존 MENU_ICON 블록 검사에 포함된다. 추출 결과를 정확히 비교하는 새 단언이 있어 맨 문자열 표로 되돌리거나 직접 문자열 일부를 누락하면 통과하지 않는다. `src/lib/menu-hub.ts:230`, `src/lib/menu-hub.ts:242`, `src/components/icons/menu-glyph.test.ts:44`, `src/components/icons/menu-glyph.test.ts:50`, `src/components/icons/menu-glyph.test.ts:52`, `src/features/owner/tabs.test.ts:104`.
- **서로 다른 메뉴의 중복 검사**: 직접 문자열 7개가 각기 한 줄에 있는 `{ icon: "…" }` 형식이라 기존 줄별 exec도 7줄을 각각 board에 넣는다. 한 줄에 여러 그림을 써 첫 그림만 잡히는 형식은 새 행 모양·행 수 단언이 허용하지 않는다. 새 runtime 검사는 실제 설정 버튼끼리의 중복을 모아 `sync → 데이터 가져오기·연동` 한 쌍만 허용한다. 리뷰 4의 `subjects`를 `history`로 바꾸는 반례는 이제 추출 누락으로 숨지 않으며 runtime 중복 단언에도 걸린다. 이 변이를 직접 실행하지는 않았다. `src/components/icons/menu-glyph.test.ts:91`, `src/components/icons/menu-glyph.test.ts:93`, `src/components/icons/menu-glyph.test.ts:96`, `src/features/owner/tabs.test.ts:90`, `src/features/owner/tabs.test.ts:101`.
- **테스트가 헛돌지 않음**: 표 슬라이스를 못 찾거나 행 추출이 비면 행 수가 15와 다르고, 각 행을 맨 문자열로 바꾸면 행 모양 단언이 실패한다. `.icon`을 빼고 객체를 목적지에 넘기면 파생된 실제 icon을 사용하는 검사·기존 타입 계약과 맞지 않는다. 두 수리의 테스트는 각각 실제 순수 함수·실제 SUPPORT_GROUPS 값을 사용한다. 페이지 본문 조건과의 정합은 코드로 직접 대조했으며, 서버 페이지의 통합 렌더 실행은 **미확인**이다. `src/features/owner/tabs.test.ts:65`, `src/features/owner/tabs.test.ts:90`, `src/features/owner/tabs.test.ts:99`, `src/features/owner/face-access.test.ts:95`, `src/app/(shell)/owner/page.tsx:143`.
- **문서**: PLAN §7의 ‘안내뿐인 면은 쓸 면이 없을 때만’ 및 `{ icon: "…" }` 형식으로 기존 가드를 회복했다는 마지막 줄은 현재 코드와 일치한다. `docs/_handoff/settings-cleanup-2026-10-05/PLAN.md:176`, `src/features/owner/face-access.ts:55`, `src/lib/menu-hub.ts:227`.

다음 특정 파일 4개만 실행해 **77개 테스트가 통과**했다. `--no-cache`는 사용하지 않았다. 조정자가 보고한 변이 20종 전체 실행은 이번 재검토에서 반복하지 않았다.

```text
npx --no-install vitest run src/features/owner/face-access.test.ts src/features/owner/tabs.test.ts src/components/icons/menu-glyph.test.ts src/lib/menu-hub.test.ts
```

판정: 커밋 가능
