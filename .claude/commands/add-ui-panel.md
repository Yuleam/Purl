새 UI 패널을 추가한다.

## 입력
- $ARGUMENTS: 패널 이름 (예: "timeline")

## 작업 순서
1. js/ui/$ARGUMENTS-panel.js 생성
   - IIFE 패턴 사용 (기존 basket-panel.js 참고)
   - window.KnittingApp.$ARGUMENTSPanel 네임스페이스
2. index.html에 패널 영역 추가
3. css/app.css에 기본 스타일 추가
4. js/ui/app.js에서 패널 초기화 코드 추가

## 규칙
- ES 모듈 사용 금지, IIFE 패턴 유지
- 기존 패널과 일관된 구조
