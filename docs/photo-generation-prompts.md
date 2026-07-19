# 실사 사진 생성 프롬프트 — Editorial 리팩토링용 (2026-07-19)

앱 곳곳의 PhotoCard(사진 + 좌하단 캡션 오버레이)에 들어갈 실사 학원 사진 10장.
현재는 **네이비 그라데이션 placeholder**가 커밋돼 있어, 아래 파일명 그대로
`public/photos/`에 **덮어쓰기만 하면 즉시 반영**된다 (코드 수정 불필요).

> 실제 인재원 공간 사진이 있으면 생성본 대신 그걸 쓰는 게 항상 더 좋다 (같은 파일명으로 저장).

## 저장 규칙

- 위치: `public/photos/<파일명>.webp`
- 권장: 폭 1600px, WebP 품질 80 (png/jpg로 생성했다면 webp 변환 후 저장)
- 비율은 아래 표 준수 (다르면 `object-cover`로 잘려 나감 — 크게 어긋나지만 않으면 OK)

## 공통 스타일 접미사 (모든 프롬프트 뒤에 붙일 것)

```
bright white modern Korean private academy interior, abundant natural daylight,
glass partitions, clean minimalist design, subtle warm wood accents, photorealistic,
professional architectural photography, no people, soft shadows, high key lighting
```

## ⚠️ 텍스트 얹는 패널 사진 주의
`login-panel`·`intake-header`는 흰 글자가 사진 위에 직접 올라간다 — **중앙부·상단이 과하게 밝은(백색 위주) 컷은 금지**,
중간 톤 이상(유리·목재·그림자 낀 구도)으로 생성/선택할 것. 오버레이 딤은 70%를 넘기지 않는 게 규약(마디아 딤 15~70).

## 프롬프트 10개

| # | 파일명 | 쓰이는 곳 | 비율 | 프롬프트 (접미사 앞부분) |
|---|---|---|---|---|
| 1 | `login-panel.webp` | 로그인 좌측 패널 (P5) | **4:5 세로** | A tall corridor of a modern academy with frosted glass study room partitions, room number decals on glass, warm ceiling light strips |
| 2 | `help-hero.webp` | 도움말 검색 히어로 (P4) | 21:9 | A tidy front desk of an academy with an open laptop, neat paper ledgers and a small plant, viewed at a slight angle |
| 3 | `intake-header.webp` | QR 공개접수 헤더 (P5) | 16:9 | Welcoming entrance of an academy with a wooden reception counter and soft pendant lights, glass door with daylight |
| 4 | `enrollment-hero.webp` | 등록상담 빈 상태/히어로 (P3) | 3:2 | A calm consultation room with a round wooden table, two empty chairs facing each other, notebook and water glasses |
| 5 | `attendance-empty.webp` | 출석부 반 미선택 허브 (P1 ✅ 적용됨) | 3:2 | A bright classroom with rows of clean white desks and green chairs, whiteboard at front, morning light through windows |
| 6 | `timetable-empty.webp` | 시간표 빈 상태 | 3:2 | A wall-mounted weekly schedule board with neat magnetic cards in an academy hallway |
| 7 | `retention-hero.webp` | 이탈방어 상단 무드 (P3) | 3:2 | A quiet individual study booth with a desk lamp glowing warmly, open textbook and pencil case |
| 8 | `meetings-hero.webp` | 회의록 상단 (P4) | 3:2 | A small meeting room with a light wood table, several chairs, a voice recorder and notepads on the table |
| 9 | `consultations-hero.webp` | 학생상담 히어로 (P3) | 3:2 | A cozy parent waiting lounge with a tan leather bench, bookshelf with neatly arranged books, small round stool |
| 10 | `intake-done.webp` | 접수 완료 화면 (P5) | 3:2 | A sunny academy window seat with a small potted plant and a welcome card on the sill |

## 완성 프롬프트 예시 (1번, 복사해서 바로 사용)

```
A tall corridor of a modern academy with frosted glass study room partitions, room number
decals on glass, warm ceiling light strips, bright white modern Korean private academy
interior, abundant natural daylight, glass partitions, clean minimalist design, subtle warm
wood accents, photorealistic, professional architectural photography, no people, soft
shadows, high key lighting
```

## 참고

- 빈 상태 일러스트(EmptyState clay 3D, `public/empty-states/`)는 **별도 계약**(640×640 투명 PNG + `pnpm test:assets`) — 이 사진들과 무관하게 유지.
- 어떤 화면이 어떤 파일을 쓰는지는 각 화면의 `PhotoCard src="/photos/…"` 검색으로 확인.
