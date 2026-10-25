# chess-replay

Chess.com에서 내가 놓친 장면을, "여기 뭔가 있다"는 신호 없이 3~5수 전부터 봇과 다시 두는 폰 웹앱.

## 시험할 것
- 퍼즐처럼 장면을 알려 주지 않고 실전처럼 다시 두게 하면, 실전에서 놓친 기회·큰 실수가 줄어드는가.
- 2주 동안 손이 가는가. 안 가면 접는다.
- 첫 관문: 폰에서 Stockfish로 한 판을 쓸 만한 시간 안에 분석할 수 있는가.

## 범위 (첫 버전)
- Chess.com 아이디만 입력. 로그인·서버 없음. 공개 API에서 **끝난 게임만** 가져온다.
- 폰에서 Stockfish(WASM, 싱글스레드)로 분석해 놓친 기회·큰 실수 장면을 찾는다. 저장은 localStorage/IndexedDB.
- 장면 3~5수 전부터 신호 없이 봇과 이어 두기, 수마다 시계. 아무것도 없는 가짜 장면도 섞는다.
- 끝나면 한 줄 결과만. 결제는 아직 붙이지 않음.

## 결과
- 분석 속도 재기 화면(`bench.html`): 아이디 → 최근 끝난 게임 고르기 → 깊이별로 한 판 분석 시간과 찾은 장면 표시.
- 이 컴퓨터(Playwright, Pixel 7 화면, 51수 블리츠 한 판): 깊이 10 0.6초, 12 1.6초, 16 14초, 20 134초.
  - 깊이 10~12에서도 짚어 둔 세 장면(14...Nxf3+, 23수 Bf7, 27...c5)을 모두 잡았다.
  - 23...Qa4(6수 메이트)는 깊이 20에서야 보인다. 얕으면 대신 Bf7(+5)을 내놓는다.
- 폰(안드로이드, Chrome 155, 2026-10-25, 같은 게임): 엔진 로드 0.4초.

  | 깊이 | 한 판 | 포지션당 평균 / 최대 | 장면 |
  |---|---|---|---|
  | 10 | 1.2초 | 12ms / 97ms | 7개 |
  | 12 | 3.1초 | 31ms / 157ms | 6개 |
  | 16 | 30초 | 291ms / 1.4초 | 6개 |
  | 20 | 289초 | 2.8초 / 16초 | 6개 (23수 최선이 Qa4로 바뀜) |

  - 첫 관문 통과: 깊이 12로 한 판 3초. "열 때마다 1~2판씩"이 충분히 된다.
  - 폰은 이 컴퓨터보다 약 2배 느리다.

## 다음 할 일
- [x] GitHub Pages로 띄워서 폰에서 재기 → 결과 복사해 여기 적기
- [x] 장면 찾기는 깊이 12, 찾은 장면만 깊이 18로 다시 봐서 남기기
- [x] 장면 4수 전부터 봇과 두는 화면(`index.html`), 끝나면 한 줄
- [x] 가짜 장면: 앞뒤 7수 동안 양쪽 모두 1폰 넘게 손해 본 수가 없는 곳, 장면 4개에 1개꼴
- [x] 앱이 열려 있는 동안 계속 분석해 쌓기(IndexedDB). 이번 달 → 지난 달 순서.
  - 앱을 안 쓰는 동안 미리 만들기는 웹앱으로는 불가(닫히면 계산이 멈춤). 사람마다 서버에서 돌리는 것은 원칙(서버는 작은 일만)에 어긋나 하지 않음.
- [ ] 폰에서 2주 써 보기: 연 날 수, 찾은 비율
- [ ] 봇 세기가 레이팅에 맞는지 폰에서 느껴 보기(특히 100~400점)
- [ ] 23수처럼 깊이 20에서야 보이는 최선 수(Qa4 메이트) 처리

## 동작 (첫 버전)
- 아이디 입력 → 끝난 게임을 최근 것부터 한 판씩 분석(깊이 12) → 찾은 장면만 깊이 16으로 다시 확인하고 하나씩 바로 저장. 장면이 없으면 첫 장면이 생기자마자 시작.
- 앱이 열려 있는 동안(화면이 보일 때) 다음 판을 계속 분석. 이번 달을 다 하면 지난 달로.
- 장면은 손해가 큰 것부터. 장면 4수 전 포지션에서 시작하고, 장면 뒤로 2수 더 두면 끝.
- 내가 원래 게임대로 두는 동안 상대도 원래 게임대로 둔다. 다른 길로 가면 봇이 받는다.
- 봇 세기: 원래 상대 레이팅. 후보 8개를 깊이 10으로 보고 레이팅이 낮을수록 점수 차를 덜 따져 고르며, 가끔 아무 수나 둔다(100점: 12%, 400점: 5%, 800점: 2%, 1600점 이상: 0). 첫 버전(25%/12%/5%)은 폰에서 너무 약했다.
- 시계: 내 수 하나에 20초꼴(7수에 2분 20초). 수마다 쓴 시간을 잰다.
- 판정: 장면에서 둔 수가 최선과 1.2폰 안이면 찾은 것. 결과는 한 줄 + 장면 포지션에 화살표(초록: 좋은 수, 빨강: 둔 수). '끝난 판 보기'로 오갈 수 있다.
- 판·기물: cm-chessboard + 위키백과 표준 기물(직접 그린 판은 보기 어려워서 바꿈).
- 홈: 준비된 장면 수, 찾은 비율, 분석한 게임, 최근 2주 동안 연 날, 최근에 둔 장면 5개. 아이디를 바꾸면 기록을 지운다.
- 두는 동안 화면에는 상대·시계·판만. 결과는 판 아래 카드(제목, 한 줄, 이 수에 쓴 시간과 원래 게임에서 쓴 시간, 화살표).

## 저장
- 모두 이 기기 안(IndexedDB, 아이디만 localStorage). 서버로 보내는 것 없음.
- 처음 시작할 때 브라우저에 영구 보관을 요청(`navigator.storage.persist`). 설정에서 크기 확인·전부 지우기.

## 배포
두 가지로 낸다. 화면·분석 코드는 같다.

| | 안드로이드 앱 (주) | 웹 (간단 이용, 아이폰 등) |
|---|---|---|
| 받는 곳 | 플레이 스토어(예정), 지금은 APK | https://lesumein.github.io/chess-replay/ , 홈 화면에 설치(PWA) |
| 닫아 둔 동안 분석 | 됨: 안드로이드 작업(WorkManager)이 1시간쯤마다(네트워크 연결·배터리 여유 있을 때) 화면 없는 WebView로 `background.html`을 열어 최대 8분 분석 | 안 됨: 열려 있는 동안만 |
| 업데이트 | 스토어에 새 버전 | 사이트에 올리면 다음에 열 때 |

### 안드로이드 앱 (Capacitor 8.5.3)
- `android/`: Capacitor가 만든 프로젝트. 직접 쓴 것은 `MainActivity.java`(작업 예약)와 `AnalyzeWorker.java`(백그라운드 분석)뿐.
- 화면 없는 WebView도 주소를 앱과 같은 `https://localhost`로 맞춰, 같은 IndexedDB에 장면을 쌓는다. 다음에 앱을 열면 홈에 "앱을 닫아 둔 동안 N개 만들어 뒀어요".
- 빌드: `npm ci && npm run apk` → `android/app/build/outputs/apk/debug/app-debug.apk` (JDK 21, Android SDK 36 필요).
- 릴리스: GitHub Actions(`android`)가 main 푸시마다 서명된 APK·AAB를 아티팩트로 올리고, `v*` 태그나 수동 실행(release 입력)이면 GitHub 릴리스로 낸다.
- 서명 키: 다른 앱과 같은 업로드 키. `genshin-checkin` 저장소의 `copy-secrets` 워크플로를 대상 `lesumein/chess-replay`로 수동 실행하면 시크릿 4개(`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`)가 들어온다.
- 앱 아이콘·시작 화면: `node scripts/make-icons.cjs` (`icons/icon.svg`에서 만든다).
- 플레이 스토어에 올리려면: 개발자 계정, 위 AAB, 개인정보처리방침 페이지(수집 없음이라도 필요).
- 백그라운드 분석은 에뮬레이터 없이 만들어서 아직 실제 폰에서 확인하지 못했다.

### 웹
- GitHub Pages + PWA(`manifest.webmanifest`, `sw.js`). 앱 파일과 Stockfish(7MB)는 기기에 담아 두어 인터넷 없이도 쌓인 장면을 둘 수 있다.
- `sw.js`는 담아 둔 파일을 먼저 쓰고 뒤에서 새로 받는다. 배포 후 한 번 더 열어야 새 버전이 보인다. 파일 목록이 바뀌면 `CACHE` 이름을 올린다.

## 테스트
```
node tests/app.test.cjs                    # 아이디 → 분석 → 14수 장면 두기 → 결과 → 홈
node tests/background.test.cjs             # 닫아 둔 동안 분석(background.html) → 홈 안내
node tests/bench.test.cjs                  # 깊이 10, 12, 16
DEPTHS=12,20 node tests/bench.test.cjs
```
Chess.com API는 `tests/fixtures`(내 게임 한 판, 상대 아이디는 지움)로 대신한다.

## 라이선스
- 이 저장소의 코드: Apache 2.0 (`LICENSE`).
- `stockfish/`: [Stockfish](https://github.com/official-stockfish/Stockfish) 18 lite 싱글스레드 WASM 빌드([stockfish.js](https://github.com/nmrugg/stockfish.js) npm 18.0.8)를 수정 없이 둔 것. GPL v3, 전문은 `stockfish/COPYING`. 앱과는 Web Worker의 UCI 메시지로만 주고받는다.
- `vendor/cm-chessboard/`: [cm-chessboard](https://github.com/shaack/cm-chessboard) 8.15.3, MIT. 수정 없이 두고, 비상업 라이선스인 Staunty 기물 파일(`assets/pieces/staunty.svg`)만 뺐다.
- 기물 그림(`vendor/cm-chessboard/assets/pieces/standard.svg`): Wikimedia Commons, Cburnett·Rfc1394, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). 앱 화면 아래에 출처 표기.
- Capacitor(`@capacitor/*`, MIT): 웹 코드를 안드로이드 앱으로 감싸는 도구. `android/`의 대부분은 Capacitor가 만든 틀.
- cm-chessboard·기물 그림·Capacitor는 원칙("다른 서비스의 코드·그림은 쓰지 않는다")의 예외로 2026-10-25 허용함.
