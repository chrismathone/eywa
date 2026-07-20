# 빈 상태 일러스트 15장 재생성 안내 (2026-07-20)

> **한 줄 요약**: 빈 상태 일러스트 15장이 **v1 웜 아이보리/세이지 그린** 시절 그대로라, v3 네이비 +
> 애플 쿨 뉴트럴 배경 위에서 누렇게 뜬다. **코드가 아니라 PNG 애셋**이라 이미지 재생성이 필요하다.
> 아래 프롬프트를 이미지 생성 도구(codex 등)에 넣고, 받은 파일을 `public/empty-states/`에 **같은 이름으로**
> 덮어쓰면 끝(코드 수정 불필요).

---

## 왜 바꿔야 하나 (실측)

2026-07-20 앱 네이비 통일 감사에서 나온 확정 건. 15장 전부의 불투명 픽셀 평균색을 측정한 결과:

| 캐스트 | 장수 |
|---|---|
| WARM (뚜렷한 웜) | 3 |
| warm-neutral (웜 기운 중립) | 11 |
| GREEN | 1 |
| **COOL** | **0** |

15장 중 **쿨 계열이 한 장도 없다.** 앱 배경은 v3에서 애플 쿨 뉴트럴(`#f5f5f7` 캔버스 / `#e9e9ee` soft /
`#ffffff` 카드)로 바뀌었고 브랜드는 딥 네이비(`#153e75`)라, 웜 클레이 톤 일러스트가 그 위에 얹히면
**누렇게 바랜 것처럼** 보인다.

### 장별 실측값

전부 **640×640 PNG(알파 배경)**, 118~221KB.

| 파일 | 평균색 | 캐스트 | R−B |
|---|---|---|---|
| `empty-workspace-alpha.png` | `#c9c6b4` | WARM | +21 |
| `empty-enrollment-alpha.png` | `#d5d2c6` | WARM | +15 |
| `empty-meetings-alpha.png` | `#cfccc2` | WARM | +13 |
| `empty-audit-alpha.png` | `#c3c0b7` | warm-neutral | +12 |
| `empty-staff-alpha.png` | `#ceccc2` | warm-neutral | +12 |
| `empty-students-alpha.png` | `#dfdcd3` | warm-neutral | +12 |
| `empty-billing-alpha.png` | `#cbcac0` | warm-neutral | +11 |
| `empty-leaves-alpha.png` | `#d5d4ca` | warm-neutral | +11 |
| `empty-exams-alpha.png` | `#eae7e0` | warm-neutral | +10 |
| `empty-search-alpha.png` | `#e9e8e1` | warm-neutral | +8 |
| `empty-attendance-alpha.png` | `#d5d4ce` | warm-neutral | +7 |
| `empty-classes-alpha.png` | `#e1e0da` | warm-neutral | +7 |
| `empty-sends-alpha.png` | `#d1d4ca` | warm-neutral | +7 |
| `empty-withdrawals-alpha.png` | `#adb2a6` | warm-neutral | +7 |
| `empty-documents-alpha.png` | `#b4c0b5` | **GREEN** | −1 |

> R−B가 **양수 = 웜**(빨강이 파랑보다 강함). 목표는 **0 이하**(중립~쿨).

---

## 목표 팔레트 (v3 Injaewon Navy)

| 역할 | 값 |
|---|---|
| 브랜드 (액센트) | `#153e75` 딥 네이비 |
| 캔버스 배경 | `#f5f5f7` |
| soft 배경 | `#e9e9ee` |
| 카드 | `#ffffff` |
| 잉크 (텍스트) | `#1d1d1f` |
| 보조 텍스트 | `#505050` |

일러스트는 이 배경 위에 얹히므로 **쿨 그레이 + 네이비 액센트**로 가야 자연스럽다.

---

## 📋 재생성 프롬프트 (그대로 복사해서 사용)

```
15장의 빈 상태(empty state) 일러스트를 하나의 일관된 세트로 만들어 주세요.

[스타일]
- 부드러운 3D 클레이(clay) 렌더 스타일. 매트한 질감, 뚜렷한 윤곽선 없음.
- 은은한 상단 광원 + 부드러운 접지 그림자. 과한 반사·유광 금지.
- 사람 얼굴·문자·숫자·로고 없음. 오브젝트 위주의 미니멀 구성.
- 각 장은 오브젝트 1~3개로 단순하게. 화면이 꽉 차지 않게 여백을 넉넉히.

[색 — 가장 중요]
- 쿨 뉴트럴 그레이가 주조색: #e9e9ee / #d8d8de / #c2c2cb / #9a9aa4 범위.
- 액센트는 딥 네이비 #153e75 와 그 밝은 변형 #2d6be0 를 소량만(전체의 10~20%).
- ⚠️ 웜 톤 금지: 베이지·아이보리·크림·황토·테라코타·세이지 그린을 쓰지 마세요.
- ⚠️ 각 이미지의 평균색이 "차갑거나 중립"이어야 합니다 — 빨강 채널이 파랑 채널보다
  크면 안 됩니다(R ≤ B).
- 배경은 반드시 완전 투명(알파). 배경색을 칠하지 마세요.

[출력 사양]
- 640 × 640 px, PNG, 알파 채널 포함.
- 오브젝트가 캔버스 중앙에 오고 상하좌우 약 10% 여백.

[15장의 주제]
1.  workspace   — 빈 작업 공간 / 열린 창이 하나도 없는 데스크톱 (모니터·빈 패널)
2.  attendance  — 출석 체크 (체크리스트 보드, 체크 표시)
3.  students    — 학생 명단 (사람 실루엣 카드 여러 장, 얼굴 없이)
4.  classes     — 수업/반 목록 (칠판 또는 강의실 책상)
5.  exams       — 시험/성적 (시험지 묶음, 연필)
6.  billing     — 수납/청구 (영수증, 카드, 동전)
7.  staff       — 직원 관리 (ID 배지, 명함 홀더)
8.  meetings    — 회의록 (마이크, 음성 파형, 노트)
9.  enrollment  — 등록 상담 (클립보드 신청서, 펜)
10. withdrawals — 퇴원 관리 (문에서 나가는 화살표, 빈 의자)
11. leaves      — 휴원/결석 (달력에 표시된 빈 날짜)
12. documents   — 서식 저장소 (문서 폴더, 서류 더미)
13. sends       — 발송 내역 (종이비행기, 봉투)
14. search      — 검색 결과 없음 (돋보기, 빈 카드)
15. audit       — 활동 로그/감사 (돋보기 + 목록, 시계)
```

---

## 받은 뒤 적용 방법

1. 파일명을 **정확히 아래와 같이** 맞춘다(코드가 이 이름을 하드코딩하고 있다):

   ```
   empty-workspace-alpha.png    empty-attendance-alpha.png   empty-students-alpha.png
   empty-classes-alpha.png      empty-exams-alpha.png        empty-billing-alpha.png
   empty-staff-alpha.png        empty-meetings-alpha.png     empty-enrollment-alpha.png
   empty-withdrawals-alpha.png  empty-leaves-alpha.png       empty-documents-alpha.png
   empty-sends-alpha.png        empty-search-alpha.png       empty-audit-alpha.png
   ```

   > ⚠️ **`-alpha` 접미사 필수.** 과거에 이 접미사가 빠진 경로가 코드에 남아 빈 데스크톱 일러스트가
   > 404로 깨져 있었다(2026-07-20 수정). 이름이 다르면 조용히 안 보인다.

2. `public/empty-states/` 에 덮어쓴다. **코드 수정 불필요** — `empty-state-assets.ts`가 이 이름들을
   이미 가리키고 있다.

3. 검수: 아래 스크립트로 캐스트를 재측정해 **WARM이 0장**인지 확인.

   ```bash
   python -c "
   from PIL import Image; import os
   d='public/empty-states'
   for f in sorted(os.listdir(d)):
       if not f.endswith('.png'): continue
       im=Image.open(os.path.join(d,f)).convert('RGBA'); im.thumbnail((80,80))
       px=[q for q in list(im.getdata()) if q[3]>60]
       r=sum(q[0] for q in px)//len(px); g=sum(q[1] for q in px)//len(px); b=sum(q[2] for q in px)//len(px)
       print(f'{f:34s} #{r:02x}{g:02x}{b:02x}  R-B={r-b:+d}  {\"WARM ✗\" if r>b else \"ok\"}')
   "
   ```

4. 브라우저에서 실제 화면 확인(빈 데스크톱·수업목록 결과없음·직원관리 빈 목록 등).

---

## 참고 — 소비처

- 애셋 목록: [`src/components/empty-state-assets.ts`](../src/components/empty-state-assets.ts)
- 렌더 컴포넌트: [`src/components/empty-state.tsx`](../src/components/empty-state.tsx)
  (640×640 원본을 `size-36`/`sm:size-40` = 144~160px로 축소 렌더)
- 빈 데스크톱: [`src/components/workspace/workspace-canvas.tsx`](../src/components/workspace/workspace-canvas.tsx)
  (240×240으로 별도 렌더 — 이 경로가 `-alpha` 누락으로 404였던 곳)

관련 감사 기록: `docs/changelog.md` "앱 화면 v3 네이비 미통일 전수 정리 (2026-07-20)"
