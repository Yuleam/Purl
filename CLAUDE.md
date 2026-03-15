# Knitting Project

뜨개질 — 다시 만나기 위한 도구. 이 도구의 가치는 잡는 순간이 아니라, 다시 만나는 순간에 발생한다.

## 핵심 원칙
- LLM/외부 AI API 절대 사용 금지 (프로젝트 본질에 위배)
- **가볍게 잡는다** — 캡처는 씨앗. 부담이 없어야 한다
- **다시 만나게 한다** — 과거의 조각이 현재의 필요와 자연스럽게 만나는 접점을 만든다
- **대신하지 않는다** — 연결을 판정하거나 정리하지 않는다. 조용히 놓아두고, 깨달음은 사용자에게서 나온다
- 사용자는 비개발자 — 기술 용어보다 쉬운 설명 우선
- **다정하다** — 막혀있는/흩어진/길잃은 사람에게 도구 사용법을 요구하지 않고 먼저 맞이한다

## 핵심 개념 (4개)
- **조각 (fiber)** — 잡은 문장 + 그 순간의 반응 (감도, 방향성, 생각, 출처)
- **연결 (link)** — 2개 이상 조각이 닿아있다 + 왜
- **만남 (encounter)** — 과거 조각과의 재회 (확률적 리서페이싱)
- **궤적 (trail)** — 내 조각들의 시간적 흐름 (시간 × 감도 × 방향성)

## 하지 않는 것들
- 유사도 점수 표시 (판정은 사용자의 몫)
- 자동 분류/태깅 (도구가 대신하는 것)
- 연결 종류 구분 (분류의 부담)
- 빈 홈 화면 (길 잃은 사람을 맞이하지 않는 것)
- 그래프 뷰 (탐색 방법을 강제함)
- 리뷰 의무/스트릭 (죄책감은 다정하지 않다)

## 기술 스택
- Frontend: vanilla JS, IIFE 패턴, 번들러 없음 (capture.html, explorer.html 인라인)
- Backend: Node.js + Express + sql.js (WebAssembly, no native build)
- DB: SQLite (server/data/knitting.db)
- 임베딩: KR-SBERT ONNX 로컬 실행 (server/services/embedder.js)
- MCP Server: server/mcp-server.mjs
- PWA: Service Worker + Web App Manifest + Share Target API (모바일 캡처)

## 코드 규칙
- 프론트엔드: 인라인 IIFE 패턴 (capture.html, explorer.html 각각 자체 포함)
- 한글 주석 사용
- 새 파일 최소화, 기존 파일 수정 우선
- 의존성 추가 최소화

## 서버 실행
- `node server/index.js` (포트 3001, 0.0.0.0 바인딩)
- 정적 파일 서빙: `http://localhost:3001/` (프로젝트 루트)
- 프론트엔드 접속: `http://localhost:3001/capture.html` (모바일 PWA)
- 데스크톱 궤적: `http://localhost:3001/explorer.html`
- CORS: localhost:5500, 5501, 8080, 3000, 3001 + chrome-extension:// + *.ngrok-free.app
- HTTPS 터널링: ngrok으로 PWA Share Target 테스트

## 프로젝트 구조
```
capture.html        — PWA 메인 (4뷰: 만남/잡기/포커스/궤적)
explorer.html       — 데스크톱 궤적 뷰 (2컬럼: 궤적 + 상세)
manifest.json       — PWA 매니페스트 (Share Target 설정)
sw.js               — Service Worker (PWA 설치 + 캐시)
icons/
  icon.svg            PWA 아이콘

server/
  index.js          Express 서버 진입점 (0.0.0.0 바인딩)
  db.js             DB 초기화 + 유틸리티 + 마이그레이션
  mcp-server.mjs    MCP 서버 (Claude Code 연동)
  routes/
    fibers.js       조각 CRUD + 텍스트 검색 + 유사 조각
    links.js        연결 CRUD
    encounters.js   만남 (확률 선택 + 기록)
    periphery.js    주변부 조각 (잡기 시 보조)
    trail.js        궤적 (시간순 조회 + 요약)
  services/
    embedder.js     KR-SBERT ONNX 임베딩
    hint.js         유사 조각 찾기 (하이브리드 스코어링)

extension/            — Chrome 확장 프로그램 (조각 잡기)
  manifest.json       Manifest V3
  background.js       Service Worker (우클릭 잡기 + 토스트)
  popup.html/js       팝업 UI (직접 잡기)

legacy/               — 구 코드 (Phase 6에서 정리됨, 참조용 보관)
  index.html          구 노트 에디터
  css/                구 스타일시트
  js/                 구 프론트엔드 (fiber-api, note, bookshelf 등)
  server/routes/      구 서버 라우트 (threads, stitches, knots 등)
```

## DB 테이블

### 활성
- fibers: 조각 (text, tension, tone, thought, source, caught_at 등)
- fiber_replies: 답글
- fiber_embeddings: 임베딩 (주변부/유사 조각 보조용)
- links: 연결 (why, created_at)
- link_members: 연결 멤버 (link_id, fiber_id, sort_order)
- encounters: 만남 기록 (fiber_id, encountered_at)

### 레거시 (DB에 존재하지만 코드에서 사용하지 않음)
- threads / thread_fibers: 구 실
- stitches / stitch_members: 구 코
- fabrics / fabric_members: 구 편물
- knots / knot_stitches: 매듭
- connections: 교차 연결
- notes / bookshelf_notes: 구 노트 시스템

## 사용자 경험 — 세 가지 장면
1. **만남** (앱을 열 때) — 과거 조각 하나가 전체 맥락과 함께 맞이
2. **잡기 + 주변부** (새 조각을 잡을 때) — 캡처 + 과거 조각이 조용히 옆에
3. **궤적** (내 조각들의 흐름) — 시간순 점 시각화 (색=방향성, 크기=감도)

## 사용자 대면 용어
- 장력(tension) → **감도** (UI 1~100 슬라이더 → DB 1~5 매핑: `Math.ceil(value/20)`)
- 결(tone) → **방향성**
- 공명(resonance) → **공감** (색상 #5a8a6a)
- 마찰(friction) → **비판** (색상 #c4644a)
- 물음(question) → **보류** (색상 #7a7a7a)

## API
```
조각:
  POST   /api/fibers          — 새 조각 잡기
  GET    /api/fibers/:id      — 조각 상세
  GET    /api/fibers?search=  — 텍스트 검색
  PATCH  /api/fibers/:id      — 수정
  DELETE /api/fibers/:id      — 삭제
  GET    /api/fibers/:id/hints — 유사 조각 (하이브리드 스코어링)

연결:
  POST   /api/links           — 연결 만들기 { members: [id, ...], why }
  GET    /api/links/:id       — 연결 상세
  GET    /api/fibers/:id/links — 이 조각의 모든 연결
  DELETE /api/links/:id       — 연결 삭제

만남:
  GET    /api/encounter       — 만남 조각 1개 (확률 선택)
  POST   /api/encounter       — 만남 기록 저장 { fiber_id }

주변부:
  GET    /api/periphery?text=&tone=&source=  — 주변부 조각 1~2개

궤적:
  GET    /api/trail?from=&to= — 기간 내 조각 목록
  GET    /api/trail/summary?from=&to= — 기간 요약
```

## MCP 도구
- `overview` — 전체 현황 (조각/연결/만남 수, 단계, 방향성 분포)
- `list_fibers` — 조각 목록 (정렬/페이지네이션)
- `get_fiber` — 조각 상세 (연결, 답글 포함)
- `search_fibers` — 키워드 검색
- `find_similar_fibers` — 유사 조각 (하이브리드 스코어링)
- `list_links` — 연결 목록
- `get_encounter` — 만남 조각 1개
- `get_trail` — 궤적 조회

## 로드맵
ROADMAP-REENCOUNTER.md 참조 (Phase 0~6, 완료)
