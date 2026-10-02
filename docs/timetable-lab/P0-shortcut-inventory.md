# Google Sheets 단축키 대조 인벤토리

2026-10-02. 연습실 단축키 계약의 공식 대조표다. 앱 코드와 실행 검증은 이 문서의 범위가 아니다.

출처는 [Keyboard shortcuts for Google Sheets](https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop)다. 같은 날 그 페이지의 PC, Mac, Chrome OS 표를 HTML에서 읽었다. 스크린리더 보충의 출처는 [Use Google Sheets with a screen reader](https://support.google.com/docs/answer/1632199?hl=en)다.

상태 초기값은 모든 항목이 같다. 미시험(`untested`), 앱 연결 필요(`app wiring needed`), OS 제약 미확인(`OS restriction unverified`), 구현은 미구현이다. `검증 완료`를 쓰지 않는다. 눌러 본 키가 0개다.

Mac 키를 Ctrl에서 Cmd로 일괄 치환하지 않았다. 숫자 형식, 모든 수식 표시, 컨트롤 줄이기, 수식 범위 전환의 둘째 키, 범위로 이동(Ctrl+G), 찾기 탭(Ctrl+F)은 Mac 표에도 Ctrl로 적혀 있다.

서식, 수식, 접근성, 폼, 부가기능, 탐색, 변경 기록, 그리기 편집기 행을 빼지 않았다. 검토 문서의 제외 제안은 이 인벤토리의 분모가 아니다.

## 집계

| 구분 | 수 |
|---|---:|
| PC 표 행 | 120 |
| Mac 표 행 | 123 |
| Chrome OS 표 행 | 122 |
| 플랫폼 행 합 | 365 |
| 공식 기능 ID | 132 |
| PC 표에 없는 ID | 12 |
| Mac 표에 없는 ID | 9 |
| Chrome OS 표에 없는 ID | 10 |
| 보충 항목 | 26 |
| 보충 중 키가 문서에 있는 것 | 17 |
| 보충 중 키를 모르는 것 | 9 |
| 한 플랫폼에서 코드가 겹치는 묶음 | 13 |
| 공식 문서끼리 충돌 | 7 |
| 명시적 미확인 | 9 |
| 실행 검증 | 0 |

공식 ID 132개는 플랫폼 행을 기능별로 묶은 수다. 한 플랫폼에만 있는 행은 ID로 남기고, 없는 플랫폼은 표에 없음으로 둔다. 분모에서 빼지 않았다.

## 빼지 않은 공백

- 181110은 일부 단축키가 모든 언어나 키보드에서 동작하지 않을 수 있다고만 적는다. 깨지는 키 목록은 없다.
- 다른 회사 스프레드시트 호환 단축키를 도움말의 단축키 창에서 켤 수 있다고 적는다. 켠 뒤의 키 목록은 페이지에 없다.
- 대부분의 181110 행은 셀을 편집하는 중인지 격자를 선택한 중인지 적지 않는다. 수식 입력 중, 댓글 선택 뒤, 행·열·셀 선택 뒤, 메뉴 순차 키만 문맥이 있다.
- 날짜·시각 입력의 포르투갈·이탈리아·독일·스페인 대체 키는 PC와 Mac 표에만 있다. Chrome OS 표에는 없다. PC 키를 Chrome OS에 복사하지 않았다.
- Mac 날짜·시각의 로캘 대체 원문은 Ctrl+Shift+H, Ctrl+Shift+D, Ctrl+Opt+Shift+N이다. ⌘로 고쳐 적지 않았다. 도움말 오타인지 실제 Ctrl인지는 모른다.
- Chrome OS 표는 '시트의 처음'과 '시트 왼쪽 위'에 같은 Ctrl+Search+Left를, '시트의 끝'과 '시트 오른쪽 아래'에 같은 Ctrl+Search+Right를 적는다. 별개 동작인지 중복 표기인지는 모른다.
- 행·열 숨기기는 PC·Mac이 단수 라벨, Chrome OS가 복수 라벨이다. 키 패턴은 대응하지만 한 기능으로 합치지 않았다.
- PC 수식 입력줄 크기 조절만 Up/Down이고 다른 행은 Up Arrow다. 같은 화살표 키인지는 원문을 바꾸지 않고 남겨 두었다.
- 이 인벤토리는 2026-10-02 공식 도움말 HTML의 표와, 그 페이지가 가리키는 스크린리더 도움말의 문장을 읽은 결과다. 실제 키보드, IME, OS, 브라우저에서 누르지 않았다. 검증 완료가 아니다.

같은 키를 여러 기능이 쓰는 경우는 아래 공식 목록과 JSON `sharedChords`에 있다. 문맥이 다르면 하나로 합치지 않았다.

## 문서 충돌

181110 바인딩은 유지했다. 스크린리더 도움말의 다른 문장은 대체 키가 아니라 충돌로만 적는다.

- 181110은 PC·Chrome OS Ctrl+Enter와 Mac ⌘+Enter를 범위 채우기로 적는다. 스크린리더 도움말은 Windows·Chrome OS Ctrl+Enter와 Mac Command+Enter를 셀 안 줄바꿈으로 적는다. 어느 문맥에서 어느 쪽이 되는지는 눌러 보지 않았다.
- 181110 Mac 표는 숫자 형식을 Ctrl+Shift+1부터 6으로 적는다. 스크린리더 도움말은 Mac을 Command+Shift+1부터 6으로 적는다. 인벤토리의 공식 바인딩은 181110을 따른다.
- 181110 Mac은 ⌘+Option+Shift+c/r이다. 스크린리더 도움말은 Mac을 Option+Shift+c/r로 적는다.
- 181110 Chrome OS는 Ctrl+Shift+Search+아래/위 화살표다. 스크린리더 도움말은 Windows와 Chrome OS를 묶어 Alt+아래/위 화살표로 적는다.
- 181110 Chrome OS는 Alt+Shift+위/아래 화살표다. 스크린리더 도움말은 Chrome OS 그룹 접기/펼치기를 Shift+PgUp/PgDn으로 적는다.
- 181110은 세 플랫폼의 Ctrl+Shift+f를 컨트롤 줄이기(compact controls)로 적고, Mac에만 ⌘+Option+R과 Ctrl+Shift+F를 메뉴 표시/숨김으로 또 적는다. 스크린리더 도움말은 메뉴 단축키가 안 먹을 때 세 플랫폼에서 Ctrl+Shift+f로 메뉴를 표시한다고 적는다. 같은 키가 한 명령인지 문서만으로 정하지 않는다.
- 181110의 F4는 PC 다시 실행이자, 수식 입력 중 절대/상대 참조다. Chrome OS 다시 실행 행에는 F4가 없고 참조 전환은 Search+4다. F2는 181110에서 수식 범위 선택 전환이고, 스크린리더 도움말에서는 Windows·Mac의 범위 유지 편집이다. Chrome OS 편집은 Search+2로 적혀 있다.

## 자주 쓰는 동작 (Common actions)

### gs.common.select-column

열 선택. 기능군은 선택. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Space |
| Mac | Ctrl + Space |
| Chrome OS | Ctrl + Space |

한글 풀이:
- PC: Ctrl + Space
- Mac: Ctrl + Space
- Chrome OS: Ctrl + Space

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.select-row

행 선택. 기능군은 선택. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Shift + Space |
| Mac | Shift + Space |
| Chrome OS | Shift + Space |

한글 풀이:
- PC: Shift + Space
- Mac: Shift + Space
- Chrome OS: Shift + Space

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.select-all

모두 선택. 기능군은 선택. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + a 또는 Ctrl + Shift + Space |
| Mac | ⌘ + a 또는 ⌘ + Shift + Space |
| Chrome OS | Ctrl + a |

한글 풀이:
- PC: Ctrl + a 또는 Ctrl + Shift + Space
- Mac: Cmd + a 또는 Cmd + Shift + Space
- Chrome OS: Ctrl + a

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.undo

실행 취소. 기능군은 Undo/Redo. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + z |
| Mac | ⌘ + z |
| Chrome OS | Ctrl + z |

한글 풀이:
- PC: Ctrl + z
- Mac: Cmd + z
- Chrome OS: Ctrl + z

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.redo

다시 실행. 기능군은 Undo/Redo. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + y 또는 Ctrl + Shift + z 또는 F4 |
| Mac | ⌘ + y 또는 ⌘ + Shift + z 또는 Fn + F4 |
| Chrome OS | Ctrl + y 또는 Ctrl + Shift + z |

한글 풀이:
- PC: Ctrl + y 또는 Ctrl + Shift + z 또는 F4
- Mac: Cmd + y 또는 Cmd + Shift + z 또는 Fn + F4
- Chrome OS: Ctrl + y 또는 Ctrl + Shift + z

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.find

찾기. 기능군은 검색/치환. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + f |
| Mac | ⌘ + f |
| Chrome OS | Ctrl + f |

한글 풀이:
- PC: Ctrl + f
- Mac: Cmd + f
- Chrome OS: Ctrl + f

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.find-and-replace

찾아 바꾸기. 기능군은 검색/치환. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + h |
| Mac | ⌘ + Shift + h |
| Chrome OS | Ctrl + h |

한글 풀이:
- PC: Ctrl + h
- Mac: Cmd + Shift + h
- Chrome OS: Ctrl + h

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.fill-range

선택 범위 채우기. 기능군은 채우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Enter |
| Mac | ⌘ + Enter |
| Chrome OS | Ctrl + Enter |

한글 풀이:
- PC: Ctrl + Enter
- Mac: Cmd + Enter
- Chrome OS: Ctrl + Enter

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.fill-down

아래로 채우기. 기능군은 채우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + d |
| Mac | ⌘ + d |
| Chrome OS | Ctrl + d |

한글 풀이:
- PC: Ctrl + d
- Mac: Cmd + d
- Chrome OS: Ctrl + d

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.fill-right

오른쪽으로 채우기. 기능군은 채우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + r |
| Mac | ⌘ + r |
| Chrome OS | Ctrl + r |

한글 풀이:
- PC: Ctrl + r
- Mac: Cmd + r
- Chrome OS: Ctrl + r

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.save

저장. 기능군은 저장·열기·인쇄. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

표의 조건: 원문은 변경이 Drive에 자동 저장된다고 적는다. 이 키가 별도 저장 명령을 실행하는지는 확인하지 않았다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + s |
| Mac | ⌘ + s |
| Chrome OS | Ctrl + s |

한글 풀이:
- PC: Ctrl + s
- Mac: Cmd + s
- Chrome OS: Ctrl + s

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.open

열기. 기능군은 저장·열기·인쇄. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + o |
| Mac | ⌘ + o |
| Chrome OS | Ctrl + o |

한글 풀이:
- PC: Ctrl + o
- Mac: Cmd + o
- Chrome OS: Ctrl + o

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.print

인쇄. 기능군은 저장·열기·인쇄. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + p |
| Mac | ⌘ + p |
| Chrome OS | Ctrl + p |

한글 풀이:
- PC: Ctrl + p
- Mac: Cmd + p
- Chrome OS: Ctrl + p

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.copy

복사. 기능군은 복사/잘라내기/붙여넣기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + c |
| Mac | ⌘ + c |
| Chrome OS | Ctrl + c |

한글 풀이:
- PC: Ctrl + c
- Mac: Cmd + c
- Chrome OS: Ctrl + c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.cut

잘라내기. 기능군은 복사/잘라내기/붙여넣기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + x |
| Mac | ⌘ + x |
| Chrome OS | Ctrl + x |

한글 풀이:
- PC: Ctrl + x
- Mac: Cmd + x
- Chrome OS: Ctrl + x

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.paste

붙여넣기. 기능군은 복사/잘라내기/붙여넣기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + v |
| Mac | ⌘ + v |
| Chrome OS | Ctrl + v |

한글 풀이:
- PC: Ctrl + v
- Mac: Cmd + v
- Chrome OS: Ctrl + v

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.paste-values-only

값만 붙여넣기. 기능군은 복사/잘라내기/붙여넣기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + v |
| Mac | ⌘ + Shift + v |
| Chrome OS | Ctrl + Shift + v |

한글 풀이:
- PC: Ctrl + Shift + v
- Mac: Cmd + Shift + v
- Chrome OS: Ctrl + Shift + v

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.show-common-keyboard-shortcuts

자주 쓰는 단축키 목록. 기능군은 메뉴·도움말. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + / |
| Mac | ⌘ + / |
| Chrome OS | Ctrl + / |

한글 풀이:
- PC: Ctrl + /
- Mac: Cmd + /
- Chrome OS: Ctrl + /

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.insert-new-sheet

시트 새로 넣기. 기능군은 시트·연습안 이동. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Shift + F11 |
| Mac | Shift + Fn + F11 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Shift + F11
- Mac: Shift + Fn + F11
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.compact-controls

컨트롤 줄이기. 기능군은 메뉴·도움말. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + f |
| Mac | Ctrl + Shift + f |
| Chrome OS | Ctrl + Shift + f |

한글 풀이:
- PC: Ctrl + Shift + f
- Mac: Ctrl + Shift + f
- Chrome OS: Ctrl + Shift + f

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.input-tools-on-off

입력 도구 켜기/끄기. 기능군은 셀 입력/지우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

표의 조건: 원문은 비라틴 문자 스프레드시트에서 쓸 수 있다고 적는다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + k |
| Mac | ⌘ + Shift + k |
| Chrome OS | Ctrl + Shift + k |

한글 풀이:
- PC: Ctrl + Shift + k
- Mac: Cmd + Shift + k
- Chrome OS: Ctrl + Shift + k

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.select-input-tools

입력 도구 고르기. 기능군은 셀 입력/지우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + k |
| Mac | ⌘ + Option + Shift + k |
| Chrome OS | Ctrl + Alt + Shift + k |

한글 풀이:
- PC: Ctrl + Alt + Shift + k
- Mac: Cmd + Option + Shift + k
- Chrome OS: Ctrl + Alt + Shift + k

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.tool-finder

도구 찾기. 기능군은 메뉴·도움말. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

표의 조건: 예전에 메뉴 검색이던 기능이다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + / |
| Mac | Option + / |
| Chrome OS | Alt + / |

한글 풀이:
- PC: Alt + /
- Mac: Option + /
- Chrome OS: Alt + /

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.rename-sheet

시트 이름 바꾸기. 기능군은 시트·연습안 이동. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + 1 |
| Mac | 표에 없음 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Alt + 1
- Mac: 표에 없음
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.convert-range-to-table

범위를 표로 바꾸기. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + T |
| Mac | ⌘ + Option + T |
| Chrome OS | Shift + Alt + T |

한글 풀이:
- PC: Ctrl + Alt + T
- Mac: Cmd + Option + T
- Chrome OS: Shift + Alt + T

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.select-current-region-around-selected-cell

선택 셀 주변의 현재 영역 선택. 기능군은 선택. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | ⌘ + Shift + * 또는 Ctrl + Shift + * |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: 표에 없음
- Mac: Cmd + Shift + * 또는 Ctrl + Shift + *
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.common.displays-or-hides-the-menus

메뉴 표시/숨김. 기능군은 메뉴·도움말. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | ⌘ + Option + R 또는 Ctrl + Shift + F |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: 표에 없음
- Mac: Cmd + Option + R 또는 Ctrl + Shift + F
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 셀 서식 (Format cells)

### gs.format.bold

굵게. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + b |
| Mac | ⌘ + b 또는 ⌘ + 2 또는 Ctrl + 2 |
| Chrome OS | Ctrl + b |

한글 풀이:
- PC: Ctrl + b
- Mac: Cmd + b 또는 Cmd + 2 또는 Ctrl + 2
- Chrome OS: Ctrl + b

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.underline

밑줄. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + u |
| Mac | ⌘ + u 또는 ⌘ + 4 또는 Ctrl + 4 |
| Chrome OS | Ctrl + u |

한글 풀이:
- PC: Ctrl + u
- Mac: Cmd + u 또는 Cmd + 4 또는 Ctrl + 4
- Chrome OS: Ctrl + u

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.italic

기울임. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + i |
| Mac | ⌘ + i 또는 ⌘ + 3 또는 Ctrl + 3 |
| Chrome OS | Ctrl + i |

한글 풀이:
- PC: Ctrl + i
- Mac: Cmd + i 또는 Cmd + 3 또는 Ctrl + 3
- Chrome OS: Ctrl + i

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.strikethrough

취소선. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 5 |
| Mac | ⌘ + Shift + x 또는 ⌘ + 5 또는 Ctrl + 5 |
| Chrome OS | Alt + Shift + 5 |

한글 풀이:
- PC: Alt + Shift + 5
- Mac: Cmd + Shift + x 또는 Cmd + 5 또는 Ctrl + 5
- Chrome OS: Alt + Shift + 5

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.center-align

가운데 맞춤. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + e |
| Mac | ⌘ + Shift + e |
| Chrome OS | Ctrl + Shift + e |

한글 풀이:
- PC: Ctrl + Shift + e
- Mac: Cmd + Shift + e
- Chrome OS: Ctrl + Shift + e

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.left-align

왼쪽 맞춤. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + l |
| Mac | ⌘ + Shift + l |
| Chrome OS | Ctrl + Shift + l |

한글 풀이:
- PC: Ctrl + Shift + l
- Mac: Cmd + Shift + l
- Chrome OS: Ctrl + Shift + l

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.right-align

오른쪽 맞춤. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + r |
| Mac | ⌘ + Shift + r |
| Chrome OS | Ctrl + Shift + r |

한글 풀이:
- PC: Ctrl + Shift + r
- Mac: Cmd + Shift + r
- Chrome OS: Ctrl + Shift + r

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.apply-top-border

위 테두리. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 1 |
| Mac | Option + Shift + 1 |
| Chrome OS | Alt + Shift + 1 |

한글 풀이:
- PC: Alt + Shift + 1
- Mac: Option + Shift + 1
- Chrome OS: Alt + Shift + 1

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.apply-right-border

오른쪽 테두리. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 2 |
| Mac | Option + Shift + 2 |
| Chrome OS | Alt + Shift + 2 |

한글 풀이:
- PC: Alt + Shift + 2
- Mac: Option + Shift + 2
- Chrome OS: Alt + Shift + 2

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.apply-bottom-border

아래 테두리. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 3 |
| Mac | Option + Shift + 3 |
| Chrome OS | Alt + Shift + 3 |

한글 풀이:
- PC: Alt + Shift + 3
- Mac: Option + Shift + 3
- Chrome OS: Alt + Shift + 3

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.apply-left-border

왼쪽 테두리. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 4 |
| Mac | Option + Shift + 4 |
| Chrome OS | Alt + Shift + 4 |

한글 풀이:
- PC: Alt + Shift + 4
- Mac: Option + Shift + 4
- Chrome OS: Alt + Shift + 4

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.remove-borders

테두리 지우기. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 6 |
| Mac | Option + Shift + 6 |
| Chrome OS | Alt + Shift + 6 |

한글 풀이:
- PC: Alt + Shift + 6
- Mac: Option + Shift + 6
- Chrome OS: Alt + Shift + 6

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.apply-outer-border

바깥 테두리. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + 7 또는 Ctrl + Shift + 7 |
| Mac | Option + Shift + 7 또는 ⌘ + Shift + 7 또는 Ctrl + Shift + 7 |
| Chrome OS | Alt + Shift + 7 또는 Ctrl + Shift + 7 |

한글 풀이:
- PC: Alt + Shift + 7 또는 Ctrl + Shift + 7
- Mac: Option + Shift + 7 또는 Cmd + Shift + 7 또는 Ctrl + Shift + 7
- Chrome OS: Alt + Shift + 7 또는 Ctrl + Shift + 7

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.insert-link

링크 넣기. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + k |
| Mac | ⌘ + k |
| Chrome OS | Ctrl + k |

한글 풀이:
- PC: Ctrl + k
- Mac: Cmd + k
- Chrome OS: Ctrl + k

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.insert-time

현재 시각 넣기. 기능군은 셀 입력/지우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + ; 또는 Ctrl+Shift+H [로캘: 포르투갈·이탈리아·독일·스페인] |
| Mac | ⌘ + Shift + ; 또는 Ctrl+Shift+H [로캘: 포르투갈·이탈리아·독일·스페인] |
| Chrome OS | Ctrl + Shift + ; |

한글 풀이:
- PC: Ctrl + Shift + ; 또는 Ctrl+Shift+H (로캘: 포르투갈·이탈리아·독일·스페인)
- Mac: Cmd + Shift + ; 또는 Ctrl+Shift+H (로캘: 포르투갈·이탈리아·독일·스페인)
- Chrome OS: Ctrl + Shift + ;

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.insert-date

오늘 날짜 넣기. 기능군은 셀 입력/지우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + ; 또는 Ctrl+Shift+D [로캘: 포르투갈·이탈리아·독일·스페인] |
| Mac | ⌘ + ; 또는 Ctrl+Shift+D [로캘: 포르투갈·이탈리아·독일·스페인] |
| Chrome OS | Ctrl + ; |

한글 풀이:
- PC: Ctrl + ; 또는 Ctrl+Shift+D (로캘: 포르투갈·이탈리아·독일·스페인)
- Mac: Cmd + ; 또는 Ctrl+Shift+D (로캘: 포르투갈·이탈리아·독일·스페인)
- Chrome OS: Ctrl + ;

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.insert-date-and-time

날짜와 시각 넣기. 기능군은 셀 입력/지우기. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + ; 또는 Ctrl+Alt+Shift+N [로캘: 포르투갈·이탈리아·독일·스페인] |
| Mac | ⌘ + Option + Shift + ; 또는 Ctrl+Opt+Shift+N [로캘: 포르투갈·이탈리아·독일·스페인] |
| Chrome OS | Ctrl + Alt + Shift + ; |

한글 풀이:
- PC: Ctrl + Alt + Shift + ; 또는 Ctrl+Alt+Shift+N (로캘: 포르투갈·이탈리아·독일·스페인)
- Mac: Cmd + Option + Shift + ; 또는 Ctrl+Opt+Shift+N (로캘: 포르투갈·이탈리아·독일·스페인)
- Chrome OS: Ctrl + Alt + Shift + ;

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-decimal

소수 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 1 |
| Mac | Ctrl + Shift + 1 |
| Chrome OS | Ctrl + Shift + 1 |

한글 풀이:
- PC: Ctrl + Shift + 1
- Mac: Ctrl + Shift + 1
- Chrome OS: Ctrl + Shift + 1

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-time

시간 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 2 |
| Mac | Ctrl + Shift + 2 |
| Chrome OS | Ctrl + Shift + 2 |

한글 풀이:
- PC: Ctrl + Shift + 2
- Mac: Ctrl + Shift + 2
- Chrome OS: Ctrl + Shift + 2

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-date

날짜 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 3 |
| Mac | Ctrl + Shift + 3 |
| Chrome OS | Ctrl + Shift + 3 |

한글 풀이:
- PC: Ctrl + Shift + 3
- Mac: Ctrl + Shift + 3
- Chrome OS: Ctrl + Shift + 3

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-currency

통화 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 4 |
| Mac | Ctrl + Shift + 4 |
| Chrome OS | Ctrl + Shift + 4 |

한글 풀이:
- PC: Ctrl + Shift + 4
- Mac: Ctrl + Shift + 4
- Chrome OS: Ctrl + Shift + 4

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-percentage

백분율 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 5 |
| Mac | Ctrl + Shift + 5 |
| Chrome OS | Ctrl + Shift + 5 |

한글 풀이:
- PC: Ctrl + Shift + 5
- Mac: Ctrl + Shift + 5
- Chrome OS: Ctrl + Shift + 5

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.format-as-exponent

지수 형식. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 6 |
| Mac | Ctrl + Shift + 6 |
| Chrome OS | Ctrl + Shift + 6 |

한글 풀이:
- PC: Ctrl + Shift + 6
- Mac: Ctrl + Shift + 6
- Chrome OS: Ctrl + Shift + 6

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.format.clear-formatting

서식 지우기. 기능군은 서식. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + \ |
| Mac | ⌘ + \ |
| Chrome OS | Ctrl + \ |

한글 풀이:
- PC: Ctrl + \
- Mac: Cmd + \
- Chrome OS: Ctrl + \

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 스프레드시트 이동 (Navigate spreadsheet)

### gs.navigate.move-to-beginning-of-row

행의 처음으로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Home |
| Mac | Fn + Left Arrow |
| Chrome OS | Search + Left Arrow |

한글 풀이:
- PC: Home
- Mac: Fn + Left Arrow
- Chrome OS: Search + Left Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-beginning-of-sheet

시트의 처음으로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Home |
| Mac | ⌘ + Fn + Left Arrow |
| Chrome OS | Ctrl + Search + Left Arrow |

한글 풀이:
- PC: Ctrl + Home
- Mac: Cmd + Fn + Left Arrow
- Chrome OS: Ctrl + Search + Left Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-end-of-row

행의 끝으로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | End |
| Mac | Fn + Right Arrow |
| Chrome OS | Search + Right Arrow |

한글 풀이:
- PC: End
- Mac: Fn + Right Arrow
- Chrome OS: Search + Right Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-end-of-sheet

시트의 끝으로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + End |
| Mac | ⌘ + Fn + Right Arrow |
| Chrome OS | Ctrl + Search + Right Arrow |

한글 풀이:
- PC: Ctrl + End
- Mac: Cmd + Fn + Right Arrow
- Chrome OS: Ctrl + Search + Right Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.scroll-to-active-cell

활성 셀이 보이게 스크롤. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Backspace |
| Mac | ⌘ + Backspace |
| Chrome OS | Ctrl + Backspace |

한글 풀이:
- PC: Ctrl + Backspace
- Mac: Cmd + Backspace
- Chrome OS: Ctrl + Backspace

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-next-sheet

다음 시트로 이동. 기능군은 시트·연습안 이동. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Down Arrow |
| Mac | Option + Down Arrow 또는 MacBook: Option + Right Arrow [MacBook] |
| Chrome OS | Ctrl + Shift + Search + Down Arrow |

한글 풀이:
- PC: Alt + Down Arrow
- Mac: Option + Down Arrow 또는 Option + Right Arrow (MacBook)
- Chrome OS: Ctrl + Shift + Search + Down Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-previous-sheet

이전 시트로 이동. 기능군은 시트·연습안 이동. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Up Arrow |
| Mac | Option + Up Arrow 또는 MacBook: Option + Left Arrow [MacBook] |
| Chrome OS | Ctrl + Shift + Search + Up Arrow |

한글 풀이:
- PC: Alt + Up Arrow
- Mac: Option + Up Arrow 또는 Option + Left Arrow (MacBook)
- Chrome OS: Ctrl + Shift + Search + Up Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.display-list-of-sheets

시트 목록 열기. 기능군은 시트·연습안 이동. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + k |
| Mac | Option + Shift + k |
| Chrome OS | Alt + Shift + k |

한글 풀이:
- PC: Alt + Shift + k
- Mac: Option + Shift + k
- Chrome OS: Alt + Shift + k

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.open-hyperlink

하이퍼링크 열기. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Enter |
| Mac | Option + Enter |
| Chrome OS | Alt + Enter |

한글 풀이:
- PC: Alt + Enter
- Mac: Option + Enter
- Chrome OS: Alt + Enter

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.open-explore

탐색 패널 열기. 기능군은 구글 서비스 전용. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + i |
| Mac | ⌘ + Option + Shift + i |
| Chrome OS | Ctrl + Alt + Shift + i |

한글 풀이:
- PC: Ctrl + Alt + Shift + i
- Mac: Cmd + Option + Shift + i
- Chrome OS: Ctrl + Alt + Shift + i

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.go-to-side-panel

옆 패널로 이동. 기능군은 메뉴·도움말. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + . 또는 Ctrl + Alt + , |
| Mac | ⌘ + Option + . 또는 ⌘ + Option + , |
| Chrome OS | Alt + Shift + . 또는 Alt + Shift + , |

한글 풀이:
- PC: Ctrl + Alt + . 또는 Ctrl + Alt + ,
- Mac: Cmd + Option + . 또는 Cmd + Option + ,
- Chrome OS: Alt + Shift + . 또는 Alt + Shift + ,

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-focus-out-of-spreadsheet

스프레드시트 밖으로 포커스 이동. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + m |
| Mac | Ctrl + ⌘ + Shift + m |
| Chrome OS | Ctrl + Alt + Shift + m |

한글 풀이:
- PC: Ctrl + Alt + Shift + m
- Mac: Ctrl + Cmd + Shift + m
- Chrome OS: Ctrl + Alt + Shift + m

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-quicksum

빠른 합계로 이동. 기능군은 수식. 문맥은 범위가 선택된 때.

표의 조건: 셀 범위가 선택된 때.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + q |
| Mac | Option + Shift + q |
| Chrome OS | Alt + Shift + q |

한글 풀이:
- PC: Alt + Shift + q
- Mac: Option + Shift + q
- Chrome OS: Alt + Shift + q

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-focus-to-popup

팝업으로 포커스 이동. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

표의 조건: 링크, 북마크, 이미지 팝업.

| 플랫폼 | 표의 키 |
|---|---|
| PC | holding Ctrl + Alt, press e then p |
| Mac | holding Ctrl + ⌘, press e then p |
| Chrome OS | holding Ctrl + Alt, press e then p |

한글 풀이:
- PC: Ctrl + Alt를 누른 채 e 다음 p
- Mac: Ctrl + Cmd를 누른 채 e 다음 p
- Chrome OS: Ctrl + Alt를 누른 채 e 다음 p

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.open-drop-down-menu-on-filtered-cell

필터된 셀의 드롭다운 열기. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + r |
| Mac | Ctrl + ⌘ + r |
| Chrome OS | Ctrl + Alt + r |

한글 풀이:
- PC: Ctrl + Alt + r
- Mac: Ctrl + Cmd + r
- Chrome OS: Ctrl + Alt + r

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.open-revision-history

변경 기록 열기. 기능군은 메모·댓글·이력. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + h |
| Mac | ⌘ + Option + Shift + h |
| Chrome OS | Ctrl + Alt + Shift + h |

한글 풀이:
- PC: Ctrl + Alt + Shift + h
- Mac: Cmd + Option + Shift + h
- Chrome OS: Ctrl + Alt + Shift + h

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.close-drawing-editor

그리기 편집기 닫기. 기능군은 구글 서비스 전용. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Shift + Esc |
| Mac | ⌘ + Esc 또는 Shift + Esc |
| Chrome OS | Ctrl + Esc 또는 Shift + Esc |

한글 풀이:
- PC: Shift + Esc
- Mac: Cmd + Esc 또는 Shift + Esc
- Chrome OS: Ctrl + Esc 또는 Shift + Esc

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.show-go-to-range-dialog

범위로 이동 대화상자. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | Ctrl + G |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: 표에 없음
- Mac: Ctrl + G
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.find-and-replace-with-find-tab-selected

찾기 탭이 선택된 찾아 바꾸기. 기능군은 검색/치환. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | Ctrl + F |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: 표에 없음
- Mac: Ctrl + F
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-first-cell-in-row-with-data

행에서 데이터가 있는 첫 셀로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Left Arrow |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Left Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-top-left-of-sheet

시트 왼쪽 위로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Search + Left Arrow |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Search + Left Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-last-cell-in-row-with-data

행에서 데이터가 있는 마지막 셀로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Right Arrow |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Right Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.navigate.move-to-bottom-right-of-sheet

시트 오른쪽 아래로 이동. 기능군은 셀 이동/범위 확장. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Search + Right Arrow |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Search + Right Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 메모와 댓글 (Edit notes and comments)

### gs.notes.insert-edit-note

메모 넣기/고치기. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Shift + F2 |
| Mac | Shift + F2 |
| Chrome OS | Shift + Search + 2 |

한글 풀이:
- PC: Shift + F2
- Mac: Shift + F2
- Chrome OS: Shift + Search + 2

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.notes.insert-edit-comment

댓글 넣기/고치기. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + m |
| Mac | ⌘ + Option + m |
| Chrome OS | Ctrl + Alt + m |

한글 풀이:
- PC: Ctrl + Alt + m
- Mac: Cmd + Option + m
- Chrome OS: Ctrl + Alt + m

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.notes.open-comment-discussion-thread

댓글 토론 열기. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + a |
| Mac | ⌘ + Option + Shift + a |
| Chrome OS | Ctrl + Alt + Shift + a |

한글 풀이:
- PC: Ctrl + Alt + Shift + a
- Mac: Cmd + Option + Shift + a
- Chrome OS: Ctrl + Alt + Shift + a

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.notes.enter-current-comment

현재 댓글로 들어가기. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | holding Ctrl + Alt, press e then c |
| Mac | holding Ctrl + ⌘, press e then c |
| Chrome OS | holding Ctrl + Alt, press e then c |

한글 풀이:
- PC: Ctrl + Alt를 누른 채 e 다음 c
- Mac: Ctrl + Cmd를 누른 채 e 다음 c
- Chrome OS: Ctrl + Alt를 누른 채 e 다음 c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.notes.move-to-next-comment

다음 댓글로 이동. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | holding Ctrl + Alt, press n then c |
| Mac | holding Ctrl + ⌘, press n then c |
| Chrome OS | holding Ctrl + Alt, press n then c |

한글 풀이:
- PC: Ctrl + Alt를 누른 채 n 다음 c
- Mac: Ctrl + Cmd를 누른 채 n 다음 c
- Chrome OS: Ctrl + Alt를 누른 채 n 다음 c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.notes.move-to-previous-comment

이전 댓글로 이동. 기능군은 메모·댓글·이력. 문맥은 메모·댓글. 순차 키와 단일 단축키가 섞여 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | holding Ctrl + Alt, press p then c |
| Mac | holding Ctrl + ⌘, press p then c |
| Chrome OS | holding Ctrl + Alt, press p then c |

한글 풀이:
- PC: Ctrl + Alt를 누른 채 p 다음 c
- Mac: Ctrl + Cmd를 누른 채 p 다음 c
- Chrome OS: Ctrl + Alt를 누른 채 p 다음 c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 선택된 댓글의 단일 키 (Use keyboard shortcuts on selected comments)

### gs.comment-keys.reply-to-current-comment

현재 댓글에 답글. 기능군은 메모·댓글·이력. 문맥은 댓글이 선택된 뒤의 단일 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | R |
| Mac | R |
| Chrome OS | R |

한글 풀이:
- PC: R
- Mac: R
- Chrome OS: R

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.comment-keys.move-to-next-comment

선택된 댓글에서 다음 댓글. 기능군은 메모·댓글·이력. 문맥은 댓글이 선택된 뒤의 단일 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | J |
| Mac | J |
| Chrome OS | J |

한글 풀이:
- PC: J
- Mac: J
- Chrome OS: J

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.comment-keys.move-to-previous-comment

선택된 댓글에서 이전 댓글. 기능군은 메모·댓글·이력. 문맥은 댓글이 선택된 뒤의 단일 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | K |
| Mac | K |
| Chrome OS | K |

한글 풀이:
- PC: K
- Mac: K
- Chrome OS: K

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.comment-keys.resolve-current-comment

현재 댓글 해결. 기능군은 메모·댓글·이력. 문맥은 댓글이 선택된 뒤의 단일 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | E |
| Mac | E |
| Chrome OS | E |

한글 풀이:
- PC: E
- Mac: E
- Chrome OS: E

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.comment-keys.exit-current-comment

현재 댓글에서 나가기. 기능군은 메모·댓글·이력. 문맥은 댓글이 선택된 뒤의 단일 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | U |
| Mac | U |
| Chrome OS | U |

한글 풀이:
- PC: U
- Mac: U
- Chrome OS: U

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 메뉴 열기 (Open a menu)

### gs.menu.file-menu

파일 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + f [Google Chrome] 또는 other browsers: Alt + Shift + f [다른 브라우저] |
| Mac | Ctrl + Option + f |
| Chrome OS | Alt + f |

한글 풀이:
- PC: Alt + f (Google Chrome) 또는 Alt + Shift + f (다른 브라우저)
- Mac: Ctrl + Option + f
- Chrome OS: Alt + f

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.edit-menu

수정 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + e [Google Chrome] 또는 other browsers: Alt + Shift + e [다른 브라우저] |
| Mac | Ctrl + Option + e |
| Chrome OS | Alt + e |

한글 풀이:
- PC: Alt + e (Google Chrome) 또는 Alt + Shift + e (다른 브라우저)
- Mac: Ctrl + Option + e
- Chrome OS: Alt + e

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.view-menu

보기 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + v [Google Chrome] 또는 other browsers: Alt + Shift + v [다른 브라우저] |
| Mac | Ctrl + Option + v |
| Chrome OS | Alt + v |

한글 풀이:
- PC: Alt + v (Google Chrome) 또는 Alt + Shift + v (다른 브라우저)
- Mac: Ctrl + Option + v
- Chrome OS: Alt + v

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.insert-menu

삽입 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + i [Google Chrome] 또는 other browsers: Alt + Shift + i [다른 브라우저] |
| Mac | Ctrl + Option + i |
| Chrome OS | Alt + i |

한글 풀이:
- PC: Alt + i (Google Chrome) 또는 Alt + Shift + i (다른 브라우저)
- Mac: Ctrl + Option + i
- Chrome OS: Alt + i

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.format-menu

서식 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + o [Google Chrome] 또는 other browsers: Alt + Shift + o [다른 브라우저] |
| Mac | Ctrl + Option + o |
| Chrome OS | Alt + o |

한글 풀이:
- PC: Alt + o (Google Chrome) 또는 Alt + Shift + o (다른 브라우저)
- Mac: Ctrl + Option + o
- Chrome OS: Alt + o

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.data-menu

데이터 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + d [Google Chrome] 또는 other browsers: Alt + Shift + d [다른 브라우저] |
| Mac | Ctrl + Option + d |
| Chrome OS | Alt + d |

한글 풀이:
- PC: Alt + d (Google Chrome) 또는 Alt + Shift + d (다른 브라우저)
- Mac: Ctrl + Option + d
- Chrome OS: Alt + d

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.tools-menu

도구 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + t [Google Chrome] 또는 other browsers: Alt + Shift + t [다른 브라우저] |
| Mac | Ctrl + Option + t |
| Chrome OS | Alt + t |

한글 풀이:
- PC: Alt + t (Google Chrome) 또는 Alt + Shift + t (다른 브라우저)
- Mac: Ctrl + Option + t
- Chrome OS: Alt + t

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.open-insert-menu

삽입 메뉴 열기. 기능군은 행·열 구조. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + = (with cells selected) [셀이 선택된 때] |
| Mac | ⌘ + Option + = (with cells selected) [셀이 선택된 때] |
| Chrome OS | Ctrl + Alt + = (with cells selected) [셀이 선택된 때] |

한글 풀이:
- PC: Ctrl + Alt + = (셀이 선택된 때)
- Mac: Cmd + Option + = (셀이 선택된 때)
- Chrome OS: Ctrl + Alt + = (셀이 선택된 때)

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.open-delete-menu

삭제 메뉴 열기. 기능군은 행·열 구조. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + - (with cells selected) [셀이 선택된 때] |
| Mac | ⌘ + Option + - (with cells selected) [셀이 선택된 때] |
| Chrome OS | Ctrl + Alt + - (with cells selected) [셀이 선택된 때] |

한글 풀이:
- PC: Ctrl + Alt + - (셀이 선택된 때)
- Mac: Cmd + Option + - (셀이 선택된 때)
- Chrome OS: Ctrl + Alt + - (셀이 선택된 때)

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.form-menu

폼 메뉴. 기능군은 구글 서비스 전용. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

표의 조건: 스프레드시트가 폼에 연결된 때에만 메뉴가 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + m [Google Chrome] 또는 other browsers: Alt + Shift + m [다른 브라우저] |
| Mac | Ctrl + Option + m |
| Chrome OS | Alt + m |

한글 풀이:
- PC: Alt + m (Google Chrome) 또는 Alt + Shift + m (다른 브라우저)
- Mac: Ctrl + Option + m
- Chrome OS: Alt + m

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.add-ons-menu

부가기능 메뉴. 기능군은 구글 서비스 전용. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + n [Google Chrome] 또는 other browsers: Alt + Shift + n [다른 브라우저] |
| Mac | Ctrl + Option + n |
| Chrome OS | Alt + n |

한글 풀이:
- PC: Alt + n (Google Chrome) 또는 Alt + Shift + n (다른 브라우저)
- Mac: Ctrl + Option + n
- Chrome OS: Alt + n

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.help-menu

도움말 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + h [Google Chrome] 또는 other browsers: Alt + Shift + h [다른 브라우저] |
| Mac | Ctrl + Option + h |
| Chrome OS | Alt + h |

한글 풀이:
- PC: Alt + h (Google Chrome) 또는 Alt + Shift + h (다른 브라우저)
- Mac: Ctrl + Option + h
- Chrome OS: Alt + h

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.accessibility-menu

접근성 메뉴. 기능군은 접근성. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

표의 조건: 스크린리더 지원을 켠 뒤에만 메뉴가 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + a [Google Chrome] 또는 other browsers: Alt + Shift + a [다른 브라우저] |
| Mac | Ctrl + Option + a |
| Chrome OS | Alt + a |

한글 풀이:
- PC: Alt + a (Google Chrome) 또는 Alt + Shift + a (다른 브라우저)
- Mac: Ctrl + Option + a
- Chrome OS: Alt + a

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.sheet-menu

시트 메뉴. 기능군은 시트·연습안 이동. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

표의 조건: 시트 복사, 삭제와 그 밖의 시트 동작.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + s |
| Mac | Option + Shift + s |
| Chrome OS | Ctrl + Shift + s |

한글 풀이:
- PC: Alt + Shift + s
- Mac: Option + Shift + s
- Chrome OS: Ctrl + Shift + s

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.context-menu

상황 메뉴. 기능군은 메뉴·도움말. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + \ 또는 Shift + F10 |
| Mac | ⌘ + Shift + \ 또는 Shift + F10 |
| Chrome OS | Ctrl + Shift + \ 또는 Shift + F10 |

한글 풀이:
- PC: Ctrl + Shift + \ 또는 Shift + F10
- Mac: Cmd + Shift + \ 또는 Shift + F10
- Chrome OS: Ctrl + Shift + \ 또는 Shift + F10

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.menu.table-column-menu

표 열 메뉴. 기능군은 행·열 구조. 문맥은 메뉴를 여는 키. 이어서 누르는 글자는 순차 키.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + \ |
| Mac | ⌘ + Option + \ |
| Chrome OS | Ctrl + Alt + \ |

한글 풀이:
- PC: Ctrl + Alt + \
- Mac: Cmd + Option + \
- Chrome OS: Ctrl + Alt + \

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 행과 열 (Add or change rows and columns)

### gs.structure.insert-rows-above

위에 행 넣기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + = (with rows selected) [행이 선택된 때] 또는 in Google Chrome: Alt + i, then r, then r [Google Chrome] 또는 other browsers: Alt + Shift + i, then r, then r [다른 브라우저] |
| Mac | ⌘ + Option + = (with rows selected) [행이 선택된 때] 또는 Ctrl + Option + i, press r then r |
| Chrome OS | Ctrl + Alt + = (with rows selected) [행이 선택된 때] 또는 Alt + i, then r, then r |

한글 풀이:
- PC: Ctrl + Alt + = (행이 선택된 때) 또는 Alt + i 다음 r 다음 r (Google Chrome) 또는 Alt + Shift + i 다음 r 다음 r (다른 브라우저)
- Mac: Cmd + Option + = (행이 선택된 때) 또는 Ctrl + Option + i 다음 r 다음 r
- Chrome OS: Ctrl + Alt + = (행이 선택된 때) 또는 Alt + i 다음 r 다음 r

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.insert-rows-below

아래에 행 넣기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + i, then r, then b [Google Chrome] 또는 other browsers: Alt + Shift + i, then r, then b [다른 브라우저] |
| Mac | Ctrl + Option + i, press r then b |
| Chrome OS | Alt + i, then r, then b |

한글 풀이:
- PC: Alt + i 다음 r 다음 b (Google Chrome) 또는 Alt + Shift + i 다음 r 다음 b (다른 브라우저)
- Mac: Ctrl + Option + i 다음 r 다음 b
- Chrome OS: Alt + i 다음 r 다음 b

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.insert-columns-to-the-left

왼쪽에 열 넣기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + = (with columns selected) [열이 선택된 때] 또는 in Google Chrome: Alt + i, then c, then c [Google Chrome] 또는 other browsers: Alt + Shift + i, then c, then c [다른 브라우저] |
| Mac | ⌘ + Option + = (with columns selected) [열이 선택된 때] 또는 Ctrl + Option + i, press c then c |
| Chrome OS | Ctrl + Alt + = (with columns selected) [열이 선택된 때] 또는 Alt + i, then c, then c |

한글 풀이:
- PC: Ctrl + Alt + = (열이 선택된 때) 또는 Alt + i 다음 c 다음 c (Google Chrome) 또는 Alt + Shift + i 다음 c 다음 c (다른 브라우저)
- Mac: Cmd + Option + = (열이 선택된 때) 또는 Ctrl + Option + i 다음 c 다음 c
- Chrome OS: Ctrl + Alt + = (열이 선택된 때) 또는 Alt + i 다음 c 다음 c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.insert-columns-to-the-right

오른쪽에 열 넣기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | in Google Chrome: Alt + i, then c, then o [Google Chrome] 또는 other browsers: Alt + Shift + i, then c, then o [다른 브라우저] |
| Mac | Ctrl + Option + i, press c then o |
| Chrome OS | Alt + i, then c, then o |

한글 풀이:
- PC: Alt + i 다음 c 다음 o (Google Chrome) 또는 Alt + Shift + i 다음 c 다음 o (다른 브라우저)
- Mac: Ctrl + Option + i 다음 c 다음 o
- Chrome OS: Alt + i 다음 c 다음 o

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.delete-rows

행 삭제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + - (with rows selected) [행이 선택된 때] 또는 in Google Chrome: Alt + e, then d, then d [Google Chrome] 또는 other browsers: Alt + Shift + e, then d, then d [다른 브라우저] |
| Mac | ⌘ + Option + - (with rows selected) [행이 선택된 때] 또는 Ctrl + Option + e, then d, then d |
| Chrome OS | Ctrl + Alt + - (with rows selected) [행이 선택된 때] 또는 Alt + e, then d, then d |

한글 풀이:
- PC: Ctrl + Alt + - (행이 선택된 때) 또는 Alt + e 다음 d 다음 d (Google Chrome) 또는 Alt + Shift + e 다음 d 다음 d (다른 브라우저)
- Mac: Cmd + Option + - (행이 선택된 때) 또는 Ctrl + Option + e 다음 d 다음 d
- Chrome OS: Ctrl + Alt + - (행이 선택된 때) 또는 Alt + e 다음 d 다음 d

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.delete-columns

열 삭제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + - (with columns selected) [열이 선택된 때] 또는 in Google Chrome: Alt + e, then d, then e [Google Chrome] 또는 other browsers: Alt + Shift + e, then d, then e [다른 브라우저] |
| Mac | ⌘ + Option + - (with columns selected) [열이 선택된 때] 또는 Ctrl + Option + e, then d, then e |
| Chrome OS | Ctrl + Alt + - (with columns selected) [열이 선택된 때] 또는 Alt + e, then d, then e |

한글 풀이:
- PC: Ctrl + Alt + - (열이 선택된 때) 또는 Alt + e 다음 d 다음 e (Google Chrome) 또는 Alt + Shift + e 다음 d 다음 e (다른 브라우저)
- Mac: Cmd + Option + - (열이 선택된 때) 또는 Ctrl + Option + e 다음 d 다음 e
- Chrome OS: Ctrl + Alt + - (열이 선택된 때) 또는 Alt + e 다음 d 다음 e

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.hide-row

행 숨기기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + 9 |
| Mac | ⌘ + Option + 9 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Ctrl + Alt + 9
- Mac: Cmd + Option + 9
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.unhide-row

행 숨김 해제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 9 |
| Mac | ⌘ + Shift + 9 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Ctrl + Shift + 9
- Mac: Cmd + Shift + 9
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.hide-column

열 숨기기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + 0 |
| Mac | ⌘ + Option + 0 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Ctrl + Alt + 0
- Mac: Cmd + Option + 0
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.unhide-column

열 숨김 해제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + 0 |
| Mac | ⌘ + Shift + 0 |
| Chrome OS | 표에 없음 |

한글 풀이:
- PC: Ctrl + Shift + 0
- Mac: Cmd + Shift + 0
- Chrome OS: 표에 없음

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.group-rows-or-columns

행 또는 열 그룹. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + Right Arrow |
| Mac | Option + Shift + Right Arrow |
| Chrome OS | Alt + Shift + Right Arrow |

한글 풀이:
- PC: Alt + Shift + Right Arrow
- Mac: Option + Shift + Right Arrow
- Chrome OS: Alt + Shift + Right Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.ungroup-rows-or-columns

행 또는 열 그룹 해제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + Left Arrow |
| Mac | Option + Shift + Left Arrow |
| Chrome OS | Alt + Shift + Left Arrow |

한글 풀이:
- PC: Alt + Shift + Left Arrow
- Mac: Option + Shift + Left Arrow
- Chrome OS: Alt + Shift + Left Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.expand-grouped-rows-or-columns

그룹 펼치기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + Down Arrow |
| Mac | Option + Shift + Down Arrow |
| Chrome OS | Alt + Shift + Down Arrow |

한글 풀이:
- PC: Alt + Shift + Down Arrow
- Mac: Option + Shift + Down Arrow
- Chrome OS: Alt + Shift + Down Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.collapse-grouped-rows-or-columns

그룹 접기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Alt + Shift + Up Arrow |
| Mac | Option + Shift + Up Arrow |
| Chrome OS | Alt + Shift + Up Arrow |

한글 풀이:
- PC: Alt + Shift + Up Arrow
- Mac: Option + Shift + Up Arrow
- Chrome OS: Alt + Shift + Up Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.hide-rows

행들 숨기기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Alt + 9 |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Alt + 9

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.unhide-rows

행들 숨김 해제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Shift + 9 |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Shift + 9

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.hide-columns

열들 숨기기. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Alt + 0 |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Alt + 0

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.structure.unhide-columns

열들 숨김 해제. 기능군은 행·열 구조. 문맥은 행·열 구조. 선택 종류나 메뉴 순차 키가 대안마다 다르다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | 표에 없음 |
| Mac | 표에 없음 |
| Chrome OS | Ctrl + Shift + 0 |

한글 풀이:
- PC: 표에 없음
- Mac: 표에 없음
- Chrome OS: Ctrl + Shift + 0

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 수식 (Use formulas)

### gs.formula.show-all-formulas

모든 수식 표시. 기능군은 수식. 문맥은 수식. 편집 중인지 표에 없는 항목도 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + ~ |
| Mac | Ctrl + ~ |
| Chrome OS | Ctrl + ~ |

한글 풀이:
- PC: Ctrl + ~
- Mac: Ctrl + ~
- Chrome OS: Ctrl + ~

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.insert-array-formula

배열 수식 넣기. 기능군은 수식. 문맥은 수식. 편집 중인지 표에 없는 항목도 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Shift + Enter |
| Mac | ⌘ + Shift + Enter |
| Chrome OS | Ctrl + Shift + Enter |

한글 풀이:
- PC: Ctrl + Shift + Enter
- Mac: Cmd + Shift + Enter
- Chrome OS: Ctrl + Shift + Enter

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.collapse-an-expanded-array-formula

펼쳐진 배열 수식 접기. 기능군은 수식. 문맥은 수식. 편집 중인지 표에 없는 항목도 있다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + e |
| Mac | ⌘ + e |
| Chrome OS | Ctrl + e |

한글 풀이:
- PC: Ctrl + e
- Mac: Cmd + e
- Chrome OS: Ctrl + e

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.show-hide-formula-help

수식 도움 표시/숨김. 기능군은 수식. 문맥은 수식 입력 중.

표의 조건: 수식을 입력하는 중.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Shift + F1 |
| Mac | Shift + Fn + F1 |
| Chrome OS | Shift + Search + 1 |

한글 풀이:
- PC: Shift + F1
- Mac: Shift + Fn + F1
- Chrome OS: Shift + Search + 1

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.full-compact-formula-help

수식 도움 전체/간단히. 기능군은 수식. 문맥은 수식 입력 중.

표의 조건: 수식을 입력하는 중.

| 플랫폼 | 표의 키 |
|---|---|
| PC | F1 |
| Mac | Fn + F1 |
| Chrome OS | Search + 1 |

한글 풀이:
- PC: F1
- Mac: Fn + F1
- Chrome OS: Search + 1

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.absolute-relative-references

절대/상대 참조 전환. 기능군은 수식. 문맥은 수식 입력 중.

표의 조건: 수식을 입력하는 중.

| 플랫폼 | 표의 키 |
|---|---|
| PC | F4 |
| Mac | Fn + F4 |
| Chrome OS | Search + 4 |

한글 풀이:
- PC: F4
- Mac: Fn + F4
- Chrome OS: Search + 4

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.toggle-formula-result-previews

수식 결과 미리보기 전환. 기능군은 수식. 문맥은 수식 입력 중.

표의 조건: 수식을 입력하는 중.

| 플랫폼 | 표의 키 |
|---|---|
| PC | F9 |
| Mac | Fn + F9 |
| Chrome OS | Search + 9 |

한글 풀이:
- PC: F9
- Mac: Fn + F9
- Chrome OS: Search + 9

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.resize-formula-bar

수식 입력줄 크기 조절. 기능군은 수식. 문맥은 수식. 편집 중인지 표에 없는 항목도 있다.

표의 조건: 수식 입력줄을 위아래로 늘이거나 줄인다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Up 또는 Ctrl + Down |
| Mac | Ctrl + Option + Up 또는 Ctrl + Option + Down |
| Chrome OS | Ctrl + Shift + Up Arrow 또는 Ctrl + Shift + Down Arrow |

한글 풀이:
- PC: Ctrl + Up 또는 Ctrl + Down
- Mac: Ctrl + Option + Up 또는 Ctrl + Option + Down
- Chrome OS: Ctrl + Shift + Up Arrow 또는 Ctrl + Shift + Down Arrow

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.formula.toggle-formula-range-selection

수식 범위 선택 전환. 기능군은 수식. 문맥은 수식 입력 중.

표의 조건: 수식을 입력하는 중.

| 플랫폼 | 표의 키 |
|---|---|
| PC | F2 또는 Ctrl + e |
| Mac | F2 또는 Ctrl + e |
| Chrome OS | F2 또는 Ctrl + e |

한글 풀이:
- PC: F2 또는 Ctrl + e
- Mac: F2 또는 Ctrl + e
- Chrome OS: F2 또는 Ctrl + e

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 스크린리더 (Help for screen readers)

### gs.a11y.turn-on-screen-reader-support

스크린리더 지원 켜기. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

표의 조건: 원문이 스크린리더 도움말을 가리킨다.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + z |
| Mac | ⌘ + Option + z |
| Chrome OS | Ctrl + Alt + z |

한글 풀이:
- PC: Ctrl + Alt + z
- Mac: Cmd + Option + z
- Chrome OS: Ctrl + Alt + z

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.a11y.enable-braille-support

점자 지원 켜기. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + h |
| Mac | ⌘ + Option + h |
| Chrome OS | Ctrl + Alt + h |

한글 풀이:
- PC: Ctrl + Alt + h
- Mac: Cmd + Option + h
- Chrome OS: Ctrl + Alt + h

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.a11y.read-column

열 읽기. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + c |
| Mac | ⌘ + Option + Shift + c |
| Chrome OS | Ctrl + Alt + Shift + c |

한글 풀이:
- PC: Ctrl + Alt + Shift + c
- Mac: Cmd + Option + Shift + c
- Chrome OS: Ctrl + Alt + Shift + c

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

### gs.a11y.read-row

행 읽기. 기능군은 접근성. 문맥은 표가 셀 편집 중과 격자 선택을 구분하지 않음.

| 플랫폼 | 표의 키 |
|---|---|
| PC | Ctrl + Alt + Shift + r |
| Mac | ⌘ + Option + Shift + r |
| Chrome OS | Ctrl + Alt + Shift + r |

한글 풀이:
- PC: Ctrl + Alt + Shift + r
- Mac: Cmd + Option + Shift + r
- Chrome OS: Ctrl + Alt + Shift + r

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop

## 보충: 181110 표에 없는 격자·입력

이 절의 항목은 공식 단축키 표의 행이 아니다. 키가 있는 것은 스크린리더 도움말에 적힌 문장이고, 키가 null인 것은 문서에 없어 모르는 경우다. 둘 다 미시험이다.

### gs.supplemental.arrow-leave-selection

방향키로 선택 해제 후 포커스 이동. 기능군은 셀 이동/범위 확장. 선택 범위가 있는 때. 181110 표에는 없다.

문서에 적힌 키:

- anyPlatform: `Arrow key` — 스크린리더 도움말은 방향키를 누르면 포커스가 움직이고 범위 선택이 풀린다고 적는다. 선택이 없을 때 한 칸 이동은 두 공식 문서 모두 표로 적지 않았다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.shift-arrow-adjacent

Shift와 방향키로 인접 셀 선택. 기능군은 선택. 범위 확장. 181110 표에는 없다.

문서에 적힌 키:

- anyPlatform: `Shift + arrow keys` — 스크린리더 도움말은 Shift를 누른 채 포커스를 움직여 인접 셀을 선택한다고 적는다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.shift-ctrl-arrow-to-data-edge

Shift+Ctrl과 방향키로 채워진 값의 끝까지 선택. 기능군은 선택. 범위 확장. 181110의 PC/Mac 표에 대응 행이 없다. Chrome OS 표의 Ctrl+Left/Right는 Shift가 없는 이동이다.

문서에 적힌 키:

- documentedAs: `Shift + Ctrl, then arrow` — 스크린리더 도움말의 문장 그대로다. Mac에서 Ctrl인지 Cmd인지는 그 문장이 적지 않는다.

미확인: Mac 수정자 키가 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.move-inside-selection

선택 범위 안에서 포커스 이동. 기능군은 셀 이동/범위 확장. 범위가 선택된 때. 181110 표에는 없다.

문서에 적힌 키:

- anyPlatform: `Enter` — 위에서 아래로 이동하고 범위 안에서 돈다.
- anyPlatform: `Shift + Enter` — 아래에서 위로 이동한다.
- anyPlatform: `Tab` — 왼쪽에서 오른쪽으로 이동한다.
- anyPlatform: `Shift + Tab` — 오른쪽에서 왼쪽으로 이동한다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.start-edit

셀 편집 시작. 기능군은 셀 입력/지우기. 격자 포커스와 편집의 경계. 181110 표에는 없다.

문서에 적힌 키:

- anyPlatform: `typing` — 스크린리더 도움말은 새로 내용을 넣으려면 입력을 시작한다고 적는다.
- anyPlatform: `Enter` — 같은 문서는 있는 내용을 고치려면 Enter를 누른다고 적는다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.edit-without-clearing-selection

범위를 유지한 채 셀 편집. 기능군은 셀 입력/지우기. 범위 선택 중. 181110의 F2는 수식 입력 중 범위 선택 전환이다. 같은 키가 두 문서에서 다른 동작으로 적혀 있다.

문서에 적힌 키:

- pc: `F2`
- mac: `F2`
- chromeos: `Search + 2`

공식 항목과 키가 겹치거나 의미가 갈린다: gs.formula.toggle-formula-range-selection.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.clear-contents-delete

내용만 지우기. 기능군은 셀 입력/지우기. 행·열 이동이 아닌 내용 삭제. 181110 표에는 Delete가 없다.

문서에 적힌 키:

- anyPlatform: `Delete`

미확인: Backspace의 격자/편집 동작은 두 공식 문서에 없다. Ctrl+Backspace는 181110의 활성 셀 스크롤이다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.newline-in-cell

셀 안에 줄바꿈. 기능군은 셀 입력/지우기. 셀 편집 중. 181110은 같은 Ctrl+Enter/⌘+Enter를 범위 채우기로 적는다.

문서에 적힌 키:

- pc: `Ctrl + Enter`
- chromeos: `Ctrl + Enter`
- mac: `Command + Enter`

공식 항목과 키가 겹치거나 의미가 갈린다: gs.common.fill-range.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.name-box

이름 상자로 이동. 기능군은 셀 이동/범위 확장. 범위 주소 입력. 181110 표에는 없다. Mac의 '범위로 이동' 대화상자(Ctrl+G)와 같은 기능인지는 모른다.

문서에 적힌 키:

- pc: `Ctrl + j`
- chromeos: `Ctrl + j`
- mac: `Command + j`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.checkbox-space

체크박스 전환. 기능군은 셀 입력/지우기. 체크박스가 있는 셀. 181110 표에는 없다.

문서에 적힌 키:

- anyPlatform: `Space`

미확인: Space가 행 선택(Shift+Space)이나 편집 중 공백과 어떻게 갈리는지는 단축키 표가 적지 않는다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.autofill-series

연속 값 자동 채우기. 기능군은 채우기. 둘 이상의 연속 칸을 선택한 뒤. 181110의 범위 채우기(Ctrl+Enter)와 키가 다르다.

문서에 적힌 키:

- pc: `Ctrl + Alt + Enter`
- chromeos: `Ctrl + Alt + Enter`
- mac: `Command + Option + Enter`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.select-sheet-tabs

인접 시트 탭 여러 개 선택. 기능군은 시트·연습안 이동. 시트 탭. 181110 표에는 없다.

문서에 적힌 키:

- pc: `Ctrl + Alt + [ 또는 Ctrl + Alt + ]`
- chromeos: `Ctrl + Alt + [ 또는 Ctrl + Alt + ]`
- mac: `Command + Option + [`

미확인: Mac 문장은 대괄호 한쪽만 적는다. 반대 방향 키는 그 페이지에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.close-shortcut-overlay

단축키 목록에서 시트로 돌아오기. 기능군은 메뉴·도움말. 단축키 목록이 열린 뒤. 목록을 여는 Ctrl+/와 ⌘+/는 181110에 있다.

문서에 적힌 키:

- anyPlatform: `Escape`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.voiceover-menu-passthrough

VoiceOver에서 메뉴 키 전달. 기능군은 접근성. Mac 스크린리더. 181110의 Mac 메뉴 키와 별도로 적혀 있다.

문서에 적힌 키:

- mac: `VO + Tab, then Ctrl + Option + f`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.partial-format-in-cell

셀 내용 일부만 선택해 서식. 기능군은 서식. 편집 중. 181110의 굵게 등은 편집 중인지 적지 않는다.

문서에 적힌 키:

- anyPlatform: `Enter, then Shift + Arrow`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.select-column-second-press

열 선택을 한 번 더 눌러 열 전체 선택. 기능군은 선택. 181110은 열 선택을 한 줄만 적는다. 두 번째 누름은 스크린리더 도움말에만 있다.

문서에 적힌 키:

- anyPlatform: `Ctrl + Space, second press`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.select-row-second-press

행 선택을 한 번 더 눌러 행 전체 선택. 기능군은 선택. 181110은 행 선택을 한 줄만 적는다.

문서에 적힌 키:

- anyPlatform: `Shift + Space, second press`

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/1632199?hl=en.

### gs.supplemental.ime-hangul-enter

한글 조합 중 Enter. 기능군은 셀 입력/지우기. OS 한글 IME 조합. 공식 단축키 표와 스크린리더 도움말 모두 조합 중 동작을 적지 않는다.

키: 없음. 조합을 확정하는지, 셀 편집을 확정하는지가 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.ime-hangul-esc

한글 조합 중 Esc. 기능군은 셀 입력/지우기. OS 한글 IME 조합.

키: 없음. 조합 취소인지 셀 편집 취소인지 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.ime-hangul-arrows

한글 조합 중 방향키. 기능군은 셀 입력/지우기. OS 한글 IME 조합.

키: 없음. 조합 중 커서가 움직이는지, 조합이 깨지고 칸이 이동하는지가 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.ime-hangul-shift-chords

한글 조합 중 Shift 단축키. 기능군은 셀 입력/지우기. OS 한글 IME 조합.

키: 없음. 조합 중에 Shift 계열 단축키가 조합을 깨는지 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.ime-hangul-modifier-chords

한글 조합 중 Ctrl·Cmd·Alt 단축키. 기능군은 셀 입력/지우기. OS 한글 IME 조합.

키: 없음. 조합 중에 수정자 단축키가 전달되는지 문서에 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.ime-versus-input-tools

OS 한글 IME와 시트 입력 도구의 관계. 기능군은 셀 입력/지우기. 181110의 입력 도구는 비라틴 문자 스프레드시트용이라고만 적는다.

키: 없음. Windows 한/영, Mac 한글 입력과 시트의 Input tools가 같은 기능인지 문서가 적지 않는다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop.

### gs.supplemental.page-keys

Page Up·Page Down으로 격자 이동. 기능군은 셀 이동/범위 확장. 기본 격자 이동. 181110 표에는 없다.

키: 없음. 페이지 단위 이동 키는 공식 단축키 표에 없다. 스크린리더 도움말의 PgUp/PgDn은 Chrome OS 그룹 접기의 다른 표기일 뿐이라 여기 키로 옮기지 않았다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.backspace-alone

Backspace 단독. 기능군은 셀 입력/지우기. 격자 또는 편집. 181110에는 Ctrl+Backspace(활성 셀로 스크롤)만 있다.

키: 없음. Backspace 단독의 공식 행이 없다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: 없음.

### gs.supplemental.home-end-while-editing

편집 중 Home·End. 기능군은 셀 입력/지우기. 181110의 Home·End는 행 이동으로만 적혀 있고 편집 중 커서인지 구분하지 않는다.

키: 없음. 편집 중 Home·End가 칸 이동인지 글자 이동인지 문서가 나누지 않는다.

상태: 미시험, 앱 연결 필요, OS 제약 미확인, 미구현. 출처: https://support.google.com/docs/answer/181110?hl=en&co=GENIE.Platform%3DDesktop.

## 기계가 읽을 파일

같은 내용의 구조화 데이터는 [P0-shortcuts.json](P0-shortcuts.json)이다. 키 원문, 대안, 순차 키, 플랫폼 부재, 공유 코드, 충돌, 미확인이 거기 있다.
