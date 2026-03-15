/**
 * seed.js — 데모 데이터 생성 스크립트
 *
 * 사용법:
 *   1. 서버 실행: node server/index.js
 *   2. 다른 터미널에서: node server/seed.js
 *
 * 4개 주제에서 실제 출처 기반 올(fiber) 25개를 생성하고,
 * 교차 주제 연결(실/코/편물)을 만듭니다.
 * 시간은 최근 7일에 걸쳐 분산됩니다.
 */

const BASE = 'http://localhost:3001/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function del(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  return res;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 최근 7일에 걸쳐 분산된 시간 생성
const NOW = Date.now();
const DAY = 86400000;
function daysAgo(d) { return NOW - d * DAY; }

async function main() {
  console.log('=== 데모 데이터 생성 시작 ===\n');

  // ─── 1. 노트 (출처) 생성 ───
  console.log('[1/7] 노트(출처) 생성...');

  const noteA = await post('/notes', {
    title: '소프트웨어 설계의 본질',
    type: 'blank',
    content: '소프트웨어 설계에서 추상화, 모듈화, 복잡성 관리에 대한 명언과 통찰 모음. Fred Brooks의 "No Silver Bullet", C.A.R. Hoare의 설계 원칙, Grady Booch의 소프트웨어 철학 등을 포함한다.',
    htmlContent: '<p>소프트웨어 설계에서 추상화, 모듈화, 복잡성 관리에 대한 명언과 통찰 모음.</p>'
  });

  const noteB = await post('/notes', {
    title: '뇌과학: 기억과 연결의 원리',
    type: 'blank',
    content: '헤브의 시냅스 가소성, 뉴런 연결 패턴, 기억 형성의 신경생물학적 메커니즘에 대한 연구 정리. BRIC, 사이언스타임즈, KAIST 뉴스 등에서 수집.',
    htmlContent: '<p>헤브의 시냅스 가소성, 뉴런 연결 패턴, 기억 형성의 신경생물학적 메커니즘에 대한 연구 정리.</p>'
  });

  const noteC = await post('/notes', {
    title: '제텔카스텐과 연결적 사고',
    type: 'blank',
    content: '니클라스 루만의 제텔카스텐 방법론. 원자적 메모, 메모 간 연결, "두 번째 뇌" 개념. 9만 장의 카드로 70권의 저서를 집필한 사례. 옵시디언, Roam Research 등 현대적 구현.',
    htmlContent: '<p>니클라스 루만의 제텔카스텐 방법론. 원자적 메모, 메모 간 연결, "두 번째 뇌" 개념.</p>'
  });

  const noteD = await post('/notes', {
    title: '뜨개질과 패턴 사고',
    type: 'blank',
    content: '뜨개질의 인지적 효과, 패턴 읽기와 언어 해석의 유사성, 반복 동작의 명상적 효과, 수공예가 뇌에 미치는 영향에 대한 자료 모음.',
    htmlContent: '<p>뜨개질의 인지적 효과, 패턴 읽기와 언어 해석의 유사성, 반복 동작의 명상적 효과.</p>'
  });

  console.log(`  노트 4개 생성 완료: ${noteA.id}, ${noteB.id}, ${noteC.id}, ${noteD.id}`);

  // ─── 2. 올(Fiber) 생성 ───
  console.log('\n[2/7] 올(fiber) 생성...');

  const fibers = [];

  // --- 주제 A: 소프트웨어 설계 (7개) ---
  const fibersA = [
    {
      text: '소프트웨어 설계를 잘하는 두 가지 방법이 있다. 첫째는 빠진 게 없는지 쉽게 확인할 수 있도록 최대한 단순하게 만드는 것이고, 둘째는 빠진 게 없는지 확인할 수 없도록 최대한 복잡하게 만드는 것이다.',
      source: 'https://kldp.org/node/40325',
      tension: 5, tone: 'positive',
      thought: 'C.A.R. Hoare의 말. 결국 단순함이 검증 가능성과 연결된다는 점이 핵심.',
      noteId: noteA.id, noteTitle: noteA.title, ago: 7
    },
    {
      text: '좋은 소프트웨어의 기능이란, 복잡한 것을 간단하게 보이도록 만드는 것이다.',
      source: 'https://kldp.org/node/40325',
      tension: 4, tone: 'positive',
      thought: 'Grady Booch. 복잡성을 제거하는 게 아니라 "간단하게 보이도록" 한다는 게 흥미롭다.',
      noteId: noteA.id, noteTitle: noteA.title, ago: 7
    },
    {
      text: '완벽한 설계는 더 이상 추가할 게 없는 게 아니라, 더 이상 제거할 게 없는 것이다.',
      source: 'https://subokim.wordpress.com/2015/03/12/101-great-computer-programming-quotes/',
      tension: 5, tone: 'positive',
      thought: '앙투안 드 생텍쥐페리의 말을 소프트웨어에 적용한 것. "제거"가 핵심 동사.',
      noteId: noteA.id, noteTitle: noteA.title, ago: 6
    },
    {
      text: '소프트웨어의 복잡성은 본질적 복잡성과 우연적 복잡성으로 나뉜다. 본질적 복잡성은 문제 영역 자체에 내재한 것이고, 우연적 복잡성은 도구나 방법에서 비롯된 것이다.',
      source: 'http://www.techsuda.com/archives/2362',
      tension: 4, tone: 'positive',
      thought: 'Fred Brooks의 No Silver Bullet. 우리가 줄일 수 있는 건 우연적 복잡성뿐이라는 것.',
      noteId: noteA.id, noteTitle: noteA.title, ago: 6
    },
    {
      text: '관심사의 분리란 각각의 관심사에 집중할 수 있도록 코드를 분리하는 설계 원칙이다. 한 번에 한 가지만 걱정할 수 있게 만드는 것.',
      source: 'https://velog.io/@eddy_song/separation-of-concerns',
      tension: 3, tone: 'positive',
      thought: '',
      noteId: noteA.id, noteTitle: noteA.title, ago: 5
    },
    {
      text: '1987년 Kent Beck과 Ward Cunningham은 건축의 패턴 언어를 프로그래밍에 적용하는 실험을 시작했다. 사용자가 잘못된 설계를 하지 않도록 핵심 포인트를 "패턴"으로 정리해서 가르친 것이 시작이었다.',
      source: 'https://ko.wikipedia.org/wiki/소프트웨어_디자인_패턴',
      tension: 3, tone: 'positive',
      thought: '건축에서 소프트웨어로의 메타포 이동. Christopher Alexander의 패턴 언어가 원래 출발점.',
      noteId: noteA.id, noteTitle: noteA.title, ago: 4
    },
    {
      text: '개발자에게 있어서 설계는 명상과 같다. 기능 목록과 전체 구조를 화두로 삼고, 이 화두가 머리 속에서 떠나지 않게 되면, 바로 이 때 지혜가 눈 앞에 환하게 나타난다.',
      source: 'https://www.gpgstudy.com/forum/viewtopic.php?t=16141',
      tension: 4, tone: 'hold',
      thought: '',
      noteId: noteA.id, noteTitle: noteA.title, ago: 3
    }
  ];

  // --- 주제 B: 뇌과학/기억 (6개) ---
  const fibersB = [
    {
      text: '두 뉴런이 동시에 활성화되면 이 두 뉴런 사이의 시냅스 연결이 강화된다. "함께 발화하는 뉴런은 함께 연결된다(Neurons that fire together, wire together)."',
      source: 'https://www.aitimes.com/news/articleView.html?idxno=168884',
      tension: 5, tone: 'positive',
      thought: '헤브의 법칙. 연결의 가장 기본 원리. 반복적으로 함께 활성화되는 것이 핵심.',
      noteId: noteB.id, noteTitle: noteB.title, ago: 6
    },
    {
      text: 'LTP에 의해 뉴런들 사이에서 새로운 연결 패턴이 만들어지고, 이를 통해 경험과 연관된 특이적인 세포 집합체(cell assembly)가 뇌에서 새롭게 만들어지는 것이 기억 형성의 원리이다.',
      source: 'https://www.ibric.org/bric/trend/bio-news.do',
      tension: 4, tone: 'positive',
      thought: '기억이 "저장"되는 게 아니라 "연결 패턴이 만들어지는 것"이라는 관점이 중요.',
      noteId: noteB.id, noteTitle: noteB.title, ago: 6
    },
    {
      text: '당신의 자아의 본질은 뇌 안에 들어 있는 뉴런들 사이의 상호연결 패턴을 반영하고 있다.',
      source: 'https://brunch.co.kr/@joongilkim/93',
      tension: 5, tone: 'positive',
      thought: '"시냅스와 자아"에서. 자아가 실체가 아니라 패턴이라는 말.',
      noteId: noteB.id, noteTitle: noteB.title, ago: 5
    },
    {
      text: '작업기억에 들어온 정보가 이해되기 위해서는, 새로운 정보를 유지하면서 이와 관련된 장기기억의 사전지식을 작업기억으로 불러와 이 둘을 비교해야 한다.',
      source: 'https://21erick.org/column/6152/',
      tension: 3, tone: 'positive',
      thought: '',
      noteId: noteB.id, noteTitle: noteB.title, ago: 4
    },
    {
      text: '연관된 기억의 획득은 연관된 대상을 나타내는 뉴런 사이의 연결을 설정하거나 강화하는 결과로 여겨진다.',
      source: 'https://www.salk.edu/ko/보도-자료/모든-수준에서-연상-기억-학습/',
      tension: 3, tone: 'positive',
      thought: 'Salk Institute 연구. 연관 기억 = 뉴런 연결 강화.',
      noteId: noteB.id, noteTitle: noteB.title, ago: 3
    },
    {
      text: '뇌의 기억 통합 원리를 이용하면 인공지능의 학습 능력을 높일 수 있다. 뇌는 자면서 낮에 경험한 정보를 재활성화하고 통합한다.',
      source: 'https://m.science.ytn.co.kr/program/view_today.php?s_mcd=0082&key=202311301604216647',
      tension: 3, tone: 'hold',
      thought: '수면 중 기억 통합. 의식적 노력 없이 연결이 강화되는 과정.',
      noteId: noteB.id, noteTitle: noteB.title, ago: 2
    }
  ];

  // --- 주제 C: 제텔카스텐/연결적 사고 (7개) ---
  const fibersC = [
    {
      text: '제텔카스텐은 원자 단위의 메모를 연결해서 기억을 강화하고 새로운 아이디어를 얻는 방법이다. 제텔카스텐은 "메모로 이루어진 AI"라는 평가를 받는다.',
      source: 'https://www.learningman.co/zettelkasten/',
      tension: 4, tone: 'positive',
      thought: '"메모로 이루어진 AI"라는 표현이 인상적. 하지만 AI가 아니라 사용자가 연결의 주체라는 점이 다르다.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 5
    },
    {
      text: '니클라스 루만은 약 9만 장 이상의 카드를 작성했고, 이 시스템을 이용해 70권의 저서와 400건 이상의 논문을 발표했다.',
      source: 'https://tkim.co/2020/09/zettelkasten/',
      tension: 4, tone: 'positive',
      thought: '양도 놀랍지만, 핵심은 카드 자체가 아니라 카드 사이의 연결이었다는 것.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 5
    },
    {
      text: '창의성은 없던 걸 만들어내는 게 아니라, 이미 가진 것을 참신한 방법으로 연결하는 것이다.',
      source: 'https://blog.productibe.com/2024-11-zettelkasten-note-taking/',
      tension: 5, tone: 'positive',
      thought: '이게 이 도구의 핵심 전제. 연결 = 창의성.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 4
    },
    {
      text: '하나의 노트에는 하나의 아이디어만 담아야 한다(원자성). 이는 정보의 명확성을 유지하고, 다른 메모와 연결할 때 쉽게 연결할 수 있도록 하기 위함이다.',
      source: 'https://goldenrabbit.co.kr/2024/06/14/zettelkasten/',
      tension: 4, tone: 'positive',
      thought: '원자성이 연결성의 전제 조건. Unix 철학의 "하나의 일을 잘 하라"와 닮았다.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 3
    },
    {
      text: '메모를 하면 더 많은 아이디어를 기억하고, 다양한 아이디어를 충돌시키고 연결하게 돕는다. 그러면서 새로운 글감, 새로운 주장을 뽑아낼 수 있다.',
      source: 'https://www.learningman.co/zettelkasten/',
      tension: 3, tone: 'positive',
      thought: '"충돌"이라는 단어가 좋다. 부드러운 연결만이 아니라 마찰에서도 통찰이 나온다.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 3
    },
    {
      text: '모든 메모에는 고유한 넘버링 시스템이 적용되는데, 이 시스템은 각 메모의 위치를 명확히 하며 다른 메모들과의 연결성을 형성하는 데 필수적이다.',
      source: 'https://goldenrabbit.co.kr/2024/06/14/zettelkasten/',
      tension: 2, tone: 'critic',
      thought: '고유 ID가 연결의 전제. 하지만 넘버링보다는 의미적 연결이 더 중요하지 않을까?',
      noteId: noteC.id, noteTitle: noteC.title, ago: 2
    },
    {
      text: '하루하루 배우게 되는 것들을 하나도 빠뜨리지 않고, 내 삶의 어느 순간에는 연결해서 사용할 수 있는 자산을 복리의 이자와 함께 쌓아가는 방법.',
      source: 'https://tkim.co/2020/09/zettelkasten/',
      tension: 4, tone: 'positive',
      thought: '"복리" 메타포. 연결이 쌓일수록 가치가 기하급수적으로 증가.',
      noteId: noteC.id, noteTitle: noteC.title, ago: 1
    }
  ];

  // --- 주제 D: 뜨개질/수공예 (5개) ---
  const fibersD = [
    {
      text: '뜨개질 패턴을 읽고 해석하는 것은 마치 또 다른 언어를 분석하는 것과 유사하게 뇌를 자극한다.',
      source: 'https://blog.daum.net/nh_kim12/17202065',
      tension: 4, tone: 'positive',
      thought: '패턴 = 언어. 뜨개질 기호 체계가 프로그래밍 언어와 닮았다는 생각.',
      noteId: noteD.id, noteTitle: noteD.title, ago: 4
    },
    {
      text: '뜨개질은 하나의 작업에 집중하게 해서 과잉 활동과 미루기 행동을 줄이는 효과가 있다.',
      source: 'https://blog.daum.net/nh_kim12/17202065',
      tension: 3, tone: 'positive',
      thought: '',
      noteId: noteD.id, noteTitle: noteD.title, ago: 3
    },
    {
      text: '파킨슨병 환자가 뜨개질을 하면 미세 운동 기능이 개선되고, 뜨개질을 하는 동안 통증 완화를 경험한다.',
      source: 'https://blog.daum.net/nh_kim12/17202065',
      tension: 3, tone: 'hold',
      thought: '수공예의 치료적 효과. 손의 반복 동작이 뇌 가소성과 연결?',
      noteId: noteD.id, noteTitle: noteD.title, ago: 2
    },
    {
      text: '한국과 일본에서는 뜨개질 패턴을 차트(도표) 형식으로 보여주고, 북미와 유럽에서는 텍스트 기반의 기호 체계를 사용한다.',
      source: 'https://namu.wiki/w/뜨개질',
      tension: 2, tone: 'positive',
      thought: '시각적 표현 vs 텍스트 표현. 같은 정보를 다르게 인코딩하는 문화적 차이.',
      noteId: noteD.id, noteTitle: noteD.title, ago: 1
    },
    {
      text: '마음챙김은 운동 능력이나 근력처럼 훈련할 때마다 늘어나고, 하지 않으면 줄어든다. 반복해서 수행하다 보면 명상 상태가 조금씩 깊어진다.',
      source: 'https://www.mabopractice.com/blog/64facd2faf8d5a559310a2cd',
      tension: 3, tone: 'positive',
      thought: '반복의 힘. 뜨개질의 반복 동작도 이런 원리?',
      noteId: noteD.id, noteTitle: noteD.title, ago: 1
    }
  ];

  const allFiberData = [...fibersA, ...fibersB, ...fibersC, ...fibersD];

  for (const f of allFiberData) {
    const fiber = await post('/fibers', {
      text: f.text,
      source: f.source,
      source_note_id: f.noteId,
      source_note_title: f.noteTitle,
      tension: f.tension,
      tone: f.tone
    });
    fibers.push({ ...fiber, _thought: f.thought, _ago: f.ago });
    process.stdout.write('.');
    // 임베딩 생성 대기 (ONNX 로컬 처리)
    await sleep(800);
  }

  // thought 업데이트 (PATCH)
  for (const f of fibers) {
    if (f._thought) {
      await fetch(`${BASE}/fibers/${f.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thought: f._thought })
      });
    }
  }

  console.log(`\n  올 ${fibers.length}개 생성 완료`);

  // 올 인덱스 (주제별)
  const A = fibers.slice(0, 7);   // 소프트웨어 설계
  const B = fibers.slice(7, 13);  // 뇌과학
  const C = fibers.slice(13, 20); // 제텔카스텐
  const D = fibers.slice(20, 25); // 뜨개질

  // ─── 3. 답글(Replies) 생성 ───
  console.log('\n[3/7] 답글(reply) 생성...');

  const replies = [
    { fiberId: A[0].id, note: '이 원칙이 코드 리뷰에서도 적용된다. 리뷰어가 "빠진 게 없는지 확인할 수 있는" 코드가 좋은 코드.' },
    { fiberId: A[3].id, note: '우리 프로젝트에서 번들러를 안 쓰는 것도 우연적 복잡성을 줄이려는 시도일 수 있겠다.' },
    { fiberId: B[0].id, note: '이 원리가 앱의 유사도 알고리즘에도 적용되면 재미있겠다. 자주 함께 조회되는 올들의 연결 가중치를 높인다든지.' },
    { fiberId: B[2].id, note: '자아가 패턴이라면, 이 도구로 만드는 연결 그래프도 일종의 "사고의 자아"가 되는 건가?' },
    { fiberId: C[2].id, note: '그렇다면 이 도구가 해야 할 일은 "연결을 제안"하는 거지, "연결을 만드는" 게 아니다. 사용자가 연결의 주체여야 한다.' },
    { fiberId: C[4].id, note: '마찰(friction)에서 오는 통찰이 있다는 것. tone 분류에서 friction이 중요한 이유.' },
    { fiberId: D[0].id, note: '프로그래밍 언어를 배우는 것과 뜨개질 패턴을 배우는 것이 인지적으로 유사한 과정이라면, 이 도구의 메타포가 단순한 비유가 아닐 수 있다.' }
  ];

  for (const r of replies) {
    await post(`/fibers/${r.fiberId}/replies`, { note: r.note });
    await sleep(300);
  }
  console.log(`  답글 ${replies.length}개 생성 완료`);

  // ─── 4. 실(Thread) 생성 ── 교차 주제 연결이 핵심 ───
  console.log('\n[4/7] 실(thread) 생성...');

  const threads = [];

  const threadData = [
    // 교차: 소프트웨어 × 뇌과학
    {
      fiberIds: [A[0].id, B[2].id],
      why: '단순한 설계가 검증 가능성을 높인다(Hoare)는 것과, 자아가 뉴런 연결 패턴이라는 것. 둘 다 "복잡성의 본질은 구성 요소가 아니라 연결 방식에 있다"고 말하고 있다.'
    },
    {
      fiberIds: [A[3].id, B[1].id],
      why: '본질적/우연적 복잡성 구분(Brooks)과 기억의 연결 패턴 형성. 뇌도 본질적 연결(경험 기반)과 우연적 연결(노이즈)을 구분하는 메커니즘이 있을 것이다.'
    },
    {
      fiberIds: [A[4].id, B[3].id],
      why: '"한 번에 한 가지만 걱정하게 만드는 것"(관심사 분리)이 작업기억의 제한된 용량과 일치한다. 좋은 설계는 인지 부하를 줄이는 설계.'
    },
    // 교차: 소프트웨어 × 제텔카스텐
    {
      fiberIds: [A[2].id, C[3].id],
      why: '"더 이상 제거할 게 없는 설계"와 "하나의 노트에 하나의 아이디어(원자성)". 둘 다 단위의 순수성을 추구한다. 모듈이 작을수록 조합이 자유롭다.'
    },
    {
      fiberIds: [A[5].id, C[0].id],
      why: '패턴 언어(Beck/Cunningham)와 제텔카스텐 모두 "반복되는 구조를 이름 붙여 재사용"한다는 공통점. 패턴 인식 → 이름 부여 → 연결의 도구화.'
    },
    // 교차: 뇌과학 × 제텔카스텐
    {
      fiberIds: [B[0].id, C[6].id],
      why: '"함께 발화하는 뉴런은 함께 연결된다"와 "복리의 이자처럼 쌓이는 연결". 헤브의 법칙이 제텔카스텐이 작동하는 신경과학적 근거.'
    },
    {
      fiberIds: [B[5].id, C[4].id],
      why: '수면 중 뇌가 기억을 통합/연결하는 것과, 메모를 "충돌시켜" 새로운 통찰을 얻는 것. 무의식적 통합과 의식적 연결의 상보성.'
    },
    // 교차: 뜨개질 × 뇌과학
    {
      fiberIds: [D[0].id, B[0].id],
      why: '뜨개질 패턴 읽기가 뇌를 언어처럼 자극한다는 것과 헤브 학습. 패턴을 반복적으로 읽고 실행하면 해당 뉴런 경로가 강화될 것이다.'
    },
    // 교차: 뜨개질 × 소프트웨어
    {
      fiberIds: [D[3].id, A[5].id],
      why: '뜨개질의 차트 vs 텍스트 패턴 표현과 디자인 패턴. 같은 구조를 시각적/언어적으로 표현하는 방식이 문화권마다 다르다는 것. 소프트웨어에서도 UML(차트) vs 코드(텍스트).'
    },
    // 교차: 뜨개질 × 제텔카스텐
    {
      fiberIds: [D[4].id, C[6].id],
      why: '반복 훈련으로 깊어지는 마음챙김과, 매일 쌓는 메모의 복리 효과. 둘 다 "꾸준한 반복이 질적 변화를 만든다"는 같은 원리.'
    }
  ];

  for (const t of threadData) {
    const thread = await post('/threads', {
      fiber_ids: t.fiberIds,
      why: t.why
    });
    threads.push(thread);
    await sleep(500);
  }
  console.log(`  실 ${threads.length}개 생성 완료`);

  // ─── 5. 코(Stitch) 생성 ───
  console.log('\n[5/7] 코(stitch) 생성...');

  const stitches = [];

  const stitchData = [
    {
      members: [
        { type: 'thread', id: threads[0].id },  // 소프트웨어×뇌과학: 연결방식이 본질
        { type: 'thread', id: threads[3].id }   // 소프트웨어×제텔카스텐: 단위의 순수성
      ],
      why: '소프트웨어 설계와 뇌, 그리고 메모 시스템이 공유하는 원리: "좋은 구성 요소(모듈/뉴런/메모)는 작고 순수하며, 가치는 그 연결에서 나온다." 부품이 아니라 관계가 본질이다.'
    },
    {
      members: [
        { type: 'thread', id: threads[5].id },  // 뇌과학×제텔카스텐: 헤브 법칙 = 복리
        { type: 'thread', id: threads[7].id }   // 뜨개질×뇌과학: 패턴 반복과 뉴런 강화
      ],
      why: '반복이 연결을 강화한다는 원리가 뇌과학(헤브 학습), 메모법(복리), 수공예(패턴 훈련) 세 영역에서 동일하게 나타난다.'
    },
    {
      members: [
        { type: 'thread', id: threads[2].id },  // 소프트웨어×뇌과학: 인지 부하
        { type: 'thread', id: threads[6].id },  // 뇌과학×제텔카스텐: 무의식 통합
        { type: 'fiber', id: D[1].id }          // 뜨개질의 집중 효과
      ],
      why: '인지 자원의 관리. 관심사 분리로 인지 부하를 줄이고(설계), 수면 중 무의식이 통합하고(뇌), 뜨개질로 단일 작업에 집중하는 것(수공예). 모두 "제한된 주의력을 어떻게 잘 쓸 것인가"의 문제.'
    },
    {
      members: [
        { type: 'thread', id: threads[4].id },  // 소프트웨어×제텔카스텐: 패턴 인식
        { type: 'thread', id: threads[8].id }   // 뜨개질×소프트웨어: 차트 vs 텍스트
      ],
      why: '패턴의 표현과 인식. 반복 구조를 이름 붙여 재사용하는 것(디자인 패턴, 제텔카스텐)과 같은 패턴을 다른 방식으로 표현하는 것(차트/텍스트). 패턴은 내용이 아니라 구조의 반복이다.'
    }
  ];

  for (const s of stitchData) {
    const stitch = await post('/stitches', {
      member_ids: s.members,
      why: s.why
    });
    stitches.push(stitch);
    await sleep(500);
  }
  console.log(`  코 ${stitches.length}개 생성 완료`);

  // ─── 6. 편물(Fabric) 생성 ───
  console.log('\n[6/7] 편물(fabric) 생성...');

  const fabric = await post('/fabrics', {
    name: '연결의 원리: 뇌에서 코드까지',
    description: '소프트웨어 설계, 뇌과학, 제텔카스텐, 뜨개질 — 네 가지 영역에서 발견되는 "연결"의 공통 원리를 모은 편물. 부품이 아니라 관계가 본질이라는 통찰.',
    member_ids: [
      { type: 'stitch', id: stitches[0].id },
      { type: 'stitch', id: stitches[1].id },
      { type: 'stitch', id: stitches[2].id },
      { type: 'stitch', id: stitches[3].id },
      { type: 'thread', id: threads[9].id }  // 뜨개질×제텔카스텐: 반복의 복리
    ]
  });
  console.log(`  편물 1개 생성 완료: ${fabric.id}`);

  // ─── 7. 교차 연결(Connection) 생성 ───
  console.log('\n[7/7] 교차 연결(connection) 생성...');

  const connData = [
    {
      source_type: 'fiber', source_id: C[2].id,  // 창의성 = 연결
      target_type: 'stitch', target_id: stitches[0].id,  // 부품<관계 통찰
      why: '이 코(stitch)가 바로 "이미 가진 것을 참신한 방법으로 연결"한 예시. 소프트웨어 설계 원칙과 뇌과학이 같은 말을 하고 있었다.'
    },
    {
      source_type: 'fiber', source_id: A[6].id,  // 설계는 명상
      target_type: 'fiber', target_id: D[1].id,  // 뜨개질의 집중
      why: '"설계가 명상과 같다"는 말과 "뜨개질이 하나의 작업에 집중하게 한다"는 말. 몰입 상태에서 패턴이 보인다는 공통 경험.'
    },
    {
      source_type: 'thread', source_id: threads[5].id,  // 헤브×복리
      target_type: 'thread', target_id: threads[9].id,  // 반복×복리
      why: '뇌의 시냅스 강화(헤브)와 뜨개질/명상의 반복 훈련 효과. 둘 다 "반복이 연결을 강화한다"는 같은 원리의 다른 표현.'
    }
  ];

  for (const c of connData) {
    await post('/connections', c);
    await sleep(300);
  }
  console.log(`  교차 연결 3개 생성 완료`);

  // ─── 완료 ───
  console.log('\n=== 데모 데이터 생성 완료 ===');
  console.log(`  노트: 4개`);
  console.log(`  올: ${fibers.length}개`);
  console.log(`  답글: ${replies.length}개`);
  console.log(`  실: ${threads.length}개`);
  console.log(`  코: ${stitches.length}개`);
  console.log(`  편물: 1개`);
  console.log(`  교차 연결: 3개`);
  console.log('\n임베딩 생성이 백그라운드에서 완료될 때까지 약 30초 대기하세요.');
  console.log('그 후 http://localhost:3001/explorer.html 에서 확인할 수 있습니다.');
}

main().catch(err => {
  console.error('오류 발생:', err);
  process.exit(1);
});
