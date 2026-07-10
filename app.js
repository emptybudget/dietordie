import * as store from './storage.js';

// ── 상태 ──────────────────────────────────────────────────────
let viewDate = store.dateKey(); // 현재 보고 있는 날짜 (YYYY-MM-DD)
let toastTimer = null;
let pendingUndo = null; // { run: () => void }

const $ = (id) => document.getElementById(id);

// ── 탭 전환 ───────────────────────────────────────────────────
const tabs = { today: $('tab-today'), summary: $('tab-summary'), settings: $('tab-settings') };
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(name) {
  for (const [key, el] of Object.entries(tabs)) el.hidden = key !== name;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'summary') renderSummaries();
  window.scrollTo(0, 0);
}

// ── 토스트 (저장 피드백 + 실행취소) ───────────────────────────
function toast(msg, undo) {
  clearTimeout(toastTimer);
  pendingUndo = undo || null;
  $('toast-msg').textContent = msg;
  const action = $('toast-action');
  action.hidden = !undo;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  pendingUndo = null;
}
$('toast-action').addEventListener('click', () => {
  if (pendingUndo) pendingUndo.run();
  hideToast();
});

// ── 날짜 ──────────────────────────────────────────────────────
function shiftDate(days) {
  const [y, m, d] = viewDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  viewDate = store.dateKey(dt);
  renderDay();
}
$('prev-day').addEventListener('click', () => shiftDate(-1));
$('next-day').addEventListener('click', () => shiftDate(1));

function dayLabel(date) {
  const today = store.dateKey();
  if (date === today) return '오늘';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  const yst = store.dateKey(new Date(new Date().setDate(new Date().getDate() - 1)));
  const prefix = date === yst ? '어제 · ' : '';
  return `${prefix}${m}월 ${d}일 (${wd})`;
}

// ── 연속 기록일 (스트릭) ──────────────────────────────────────
function computeStreak() {
  let cursor = new Date();
  if (!store.hasDay(store.dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // 오늘 미기록이면 어제부터 카운트
  }
  let count = 0;
  while (store.hasDay(store.dateKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// ── 최근 칩 (파생 계산: 최근 7일 빈도순 상위 6개) ─────────────
function recentChips(field) {
  const freq = new Map();
  const [y, m, d] = viewDate.split('-').map(Number);
  for (let i = 1; i <= 7; i++) {
    const dt = new Date(y, m - 1, d - i);
    const day = store.getDay(store.dateKey(dt));
    for (const item of day[field]) {
      const t = item.text.trim();
      if (t) freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([text]) => text);
}

// ── 수면시간 계산 ─────────────────────────────────────────────
function sleepMinutes(sleep) {
  if (!sleep || !sleep.start || !sleep.end) return null;
  const toMin = (t) => {
    const [h, mi] = t.split(':').map(Number);
    return h * 60 + mi;
  };
  let s = toMin(sleep.start);
  let e = toMin(sleep.end);
  if (e <= s) e += 24 * 60; // start > end → start는 전날 밤
  return e - s;
}
function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

// 스트릭·빈 화면 안내만 갱신 (입력 중인 필드는 건드리지 않는다)
function refreshDayMeta() {
  const day = store.getDay(viewDate);
  const streak = computeStreak();
  $('streak').textContent = streak > 0 ? `🔥 ${streak}일 연속 기록` : '';
  const isEmpty =
    day.meals.length === 0 && day.workouts.length === 0 &&
    !day.sleep && day.condition === null && !day.weight && !day.note;
  $('empty-hint').hidden = !isEmpty;
}

// ── 오늘 탭 렌더 ─────────────────────────────────────────────
function renderDay() {
  const day = store.getDay(viewDate);
  $('day-label').textContent = dayLabel(viewDate);
  refreshDayMeta();

  renderEntries('meal', day.meals);
  renderEntries('workout', day.workouts);
  renderChips('meal-chips', 'meals', 'meal-input');
  renderChips('workout-chips', 'workouts', 'workout-input');

  // 수면
  $('sleep-start').value = day.sleep?.start || '';
  $('sleep-end').value = day.sleep?.end || '';
  const min = sleepMinutes(day.sleep);
  $('sleep-duration').textContent = min !== null ? `잔 시간 ${fmtDuration(min)}` : '';

  // 컨디션
  document.querySelectorAll('#condition button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) === day.condition);
  });

  // 체중·메모
  $('weight').value = day.weight ?? '';
  $('note').value = day.note || '';

  // 내 정보 미입력 안내
  const p = store.getMeta().profile || {};
  $('profile-nudge').hidden = Boolean(p.heightCm || p.birthYear);
}

function renderEntries(kind, items) {
  const ul = $(`${kind}-list`);
  ul.innerHTML = '';
  const field = kind === 'meal' ? 'meals' : 'workouts';
  for (const item of items) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'entry-text';
    text.textContent = item.text;
    li.appendChild(text);

    if (kind === 'meal') {
      // 시간을 바로 탭해서 고칠 수 있다
      const time = document.createElement('input');
      time.type = 'time';
      time.className = 'entry-time';
      time.value = item.time || '';
      time.setAttribute('aria-label', '식사 시간');
      time.addEventListener('change', () => {
        store.updateDay(viewDate, (day) => {
          const m = day.meals.find((x) => x.id === item.id);
          if (m) m.time = time.value;
        });
        refreshDayMeta();
      });
      li.appendChild(time);
    }
    if (kind === 'workout' && (item.detail || item.minutes)) {
      const meta = document.createElement('span');
      meta.className = 'entry-meta';
      meta.textContent = [item.detail, item.minutes ? `${item.minutes}분` : null]
        .filter(Boolean).join(' · ');
      li.appendChild(meta);
    }

    const del = document.createElement('button');
    del.className = 'del-btn';
    del.setAttribute('aria-label', '삭제');
    del.textContent = '×';
    del.addEventListener('click', () => deleteEntry(field, item.id));
    li.appendChild(del);
    ul.appendChild(li);
  }
}

function renderChips(containerId, field, inputId) {
  const box = $(containerId);
  box.innerHTML = '';
  for (const text of recentChips(field)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      addEntry(field, text, field === 'meals' ? currentTime() : null, null);
    });
    box.appendChild(chip);
  }
}

function currentTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 항목 추가/삭제 ───────────────────────────────────────────
function addEntry(field, text, time, minutes, detail) {
  text = text.trim();
  if (!text) return;
  const entry = { id: store.uid(), text };
  if (field === 'meals') entry.time = time || currentTime();
  if (field === 'workouts') {
    if (minutes) entry.minutes = minutes;
    if (detail && detail.trim()) entry.detail = detail.trim();
  }
  store.updateDay(viewDate, (day) => day[field].push(entry));
  renderDay();
  toast('기록했어요');
}

function deleteEntry(field, id) {
  let removed = null;
  let index = -1;
  store.updateDay(viewDate, (day) => {
    index = day[field].findIndex((x) => x.id === id);
    if (index !== -1) removed = day[field].splice(index, 1)[0];
  });
  renderDay();
  if (!removed) return;
  toast('삭제했어요', {
    run: () => {
      store.updateDay(viewDate, (day) => {
        const at = Math.min(index, day[field].length);
        day[field].splice(at, 0, removed);
      });
      renderDay();
    },
  });
}

// 폼 제출
$('meal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('meal-input');
  addEntry('meals', input.value, currentTime(), null);
  input.value = '';
});
$('workout-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('workout-input');
  const min = $('workout-min');
  const detail = $('workout-detail');
  addEntry('workouts', input.value, null, Number(min.value) || null, detail.value);
  input.value = '';
  min.value = '';
  detail.value = '';
});

// 수면 저장 (입력 변경 시). renderDay를 부르지 않아 편집 중인 시각이 지워지지 않는다.
function saveSleep() {
  const start = $('sleep-start').value;
  const end = $('sleep-end').value;
  const sleep = start && end ? { start, end } : null;
  store.updateDay(viewDate, (day) => { day.sleep = sleep; });
  const min = sleepMinutes(sleep);
  $('sleep-duration').textContent = min !== null ? `잔 시간 ${fmtDuration(min)}` : '';
  refreshDayMeta();
}
$('sleep-start').addEventListener('change', saveSleep);
$('sleep-end').addEventListener('change', saveSleep);

// 체중 저장 (입력 변경 시). 편집 중인 값을 덮지 않도록 renderDay는 부르지 않는다.
$('weight').addEventListener('change', () => {
  const v = Number($('weight').value) || null;
  store.updateDay(viewDate, (day) => { day.weight = v; });
  refreshDayMeta();
  if (v) toast('기록했어요');
});

// 메모 저장 (입력 변경 시)
$('note').addEventListener('change', () => {
  const v = $('note').value.trim();
  store.updateDay(viewDate, (day) => { day.note = v; });
  refreshDayMeta();
  if (v) toast('기록했어요');
});

// 컨디션 저장 (토글)
document.querySelectorAll('#condition button').forEach((b) => {
  b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    const day = store.getDay(viewDate);
    const next = day.condition === v ? null : v;
    store.updateDay(viewDate, (d) => { d.condition = next; });
    renderDay();
  });
});

// ── 프롬프트 공통 ────────────────────────────────────────────
// uptoDate를 주면 그 시점 최근 체중도 포함한다
function profileParts(uptoDate) {
  const p = store.getMeta().profile || {};
  const parts = [];
  if (p.heightCm) parts.push(`키 ${p.heightCm}cm`);
  if (uptoDate) {
    const w = latestWeight(uptoDate);
    if (w) parts.push(`체중 ${w}kg`);
  }
  if (p.targetKg) parts.push(`목표 체중 ${p.targetKg}kg`);
  if (p.birthYear) parts.push(`${p.birthYear}년생`);
  return parts;
}

// 가장 최근에 저장한 AI 답변 — 다음 프롬프트에 넣어 조언이 이어지게 한다
function lastAdviceText() {
  const s = store.getSummaries()[0];
  if (!s) return null;
  const t = s.text.trim();
  return t.length > 600 ? t.slice(0, 600) + '…' : t;
}

// date 이전(포함) 가장 최근에 기록한 체중
function latestWeight(uptoDate) {
  const dates = store.allDates().filter((d) => d <= uptoDate).reverse();
  for (const d of dates) {
    const w = store.getDay(d).weight;
    if (w) return w;
  }
  return null;
}

async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    fallbackEl.hidden = true;
    return true;
  } catch {
    // 클립보드 실패 시 수동 복사 fallback
    fallbackEl.value = text;
    fallbackEl.hidden = false;
    fallbackEl.focus();
    fallbackEl.select();
    return false;
  }
}

// 공유 시트를 지원하면 바로 AI 앱으로 보낼 수 있게 하고(모바일),
// 아니면 클립보드 복사로 되돌아간다.
async function shareOrCopy(text, fallbackEl) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled'; // 사용자가 닫음
      // 그 외 오류는 복사로 대체
    }
  }
  return (await copyText(text, fallbackEl)) ? 'copied' : 'fallback';
}

function shareToast(result) {
  if (result === 'shared') toast('공유했어요');
  else if (result === 'copied') toast('복사했어요. 쓰시는 AI에 붙여넣으세요');
  else if (result === 'fallback') toast('길게 눌러 복사하세요');
}

// ── 하루 AI 분석 프롬프트 (오늘 탭) ──────────────────────────
function buildDailyPrompt(date) {
  const day = store.getDay(date);
  if (day.meals.length === 0 && day.workouts.length === 0) return null;

  const info = profileParts(date);

  const lines = ['오늘 제 식단과 운동 기록입니다. 간단히 분석해 주세요.', ''];
  if (info.length) lines.push('[내 정보]', info.join(', '), '');
  lines.push(`[${date} 기록]`);
  if (day.meals.length) {
    lines.push('식사:');
    for (const m of day.meals) lines.push(`- ${m.time ? m.time + ' ' : ''}${m.text}`);
  }
  if (day.workouts.length) {
    lines.push('운동:');
    for (const wo of day.workouts) {
      const extra = [wo.detail, wo.minutes ? `${wo.minutes}분` : null].filter(Boolean).join(', ');
      lines.push(`- ${wo.text}${extra ? ` (${extra})` : ''}`);
    }
  }
  const min = sleepMinutes(day.sleep);
  if (min !== null) lines.push(`수면: ${fmtDuration(min)}`);
  if (day.condition !== null) lines.push(`컨디션: ${day.condition}/5`);
  if (day.note) lines.push(`메모: ${day.note}`);
  const advice = lastAdviceText();
  if (advice) lines.push('', '[지난번 AI 조언]', advice);
  lines.push(
    '',
    '[부탁]',
    '- 먹은 음식의 대략적인 섭취 칼로리를 간단히 추정해 주세요',
    '- 운동으로 소모한 칼로리도 대략 추정해 주세요',
    '- 과하거나 부족한 점이 있으면 한두 가지만 짚어 주세요',
    ...(advice ? ['- 지난번 조언에서 이어지는 관점으로 봐 주세요'] : []),
    '- 마지막 줄에 짧은 격려 한마디를 남겨 주세요',
    '',
    '[답변 형식]',
    '- 마크다운 기호 없이 평범한 문장으로 짧게 써 주세요'
  );
  return lines.join('\n');
}

// 받은 답변을 하루짜리 요약으로 저장 (요약 탭 목록에 함께 모인다)
$('save-day-answer').addEventListener('click', () => {
  const input = $('day-answer');
  const text = input.value.trim();
  if (!text) {
    toast('저장할 내용이 없어요');
    return;
  }
  store.addSummary({
    id: store.uid(),
    from: viewDate,
    to: viewDate,
    text,
    savedAt: store.nowISO(),
  });
  input.value = '';
  toast('저장했어요. 요약 탭에서 볼 수 있어요');
});

$('copy-day').addEventListener('click', async () => {
  const prompt = buildDailyPrompt(viewDate);
  if (!prompt) {
    toast('먼저 식사나 운동을 기록해 주세요');
    return;
  }
  const r = await shareOrCopy(prompt, $('day-prompt-fallback'));
  if (r !== 'cancelled') shareToast(r);
});

// ── 요약 탭 ──────────────────────────────────────────────────
function periodDates() {
  const v = $('period').value;
  if (v === 'all') {
    const all = store.allDates();
    return all.length ? all : [store.dateKey()];
  }
  const n = Number(v);
  const dates = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    dates.push(store.dateKey(dt));
  }
  return dates;
}

function buildPrompt() {
  const dates = periodDates();
  const lines = [];
  for (const date of dates) {
    if (!store.hasDay(date)) continue;
    const day = store.getDay(date);
    const parts = [];
    if (day.meals.length)
      parts.push('식사: ' + day.meals.map((m) => (m.time ? `${m.time} ${m.text}` : m.text)).join(', '));
    if (day.workouts.length)
      parts.push('운동: ' + day.workouts.map((w) => {
        const extra = [w.detail, w.minutes ? `${w.minutes}분` : null].filter(Boolean).join(', ');
        return extra ? `${w.text}(${extra})` : w.text;
      }).join(', '));
    const min = sleepMinutes(day.sleep);
    if (min !== null) parts.push(`수면: ${fmtDuration(min)}`);
    if (day.condition !== null) parts.push(`컨디션: ${day.condition}/5`);
    if (day.weight) parts.push(`체중: ${day.weight}kg`);
    if (day.note) parts.push(`메모: ${day.note}`);
    if (parts.length) lines.push(`- ${date}\n  ${parts.join('\n  ')}`);
  }

  const data = lines.length ? lines.join('\n') : '(기록 없음)';
  const info = profileParts();
  const advice = lastAdviceText();
  return [
    '아래는 제 다이어트 기록입니다. 살펴보고 조언해 주세요.',
    '',
    ...(info.length ? ['[내 정보]', info.join(', '), ''] : []),
    '[기록]',
    data,
    '',
    ...(advice ? ['[지난번 AI 조언]', advice, ''] : []),
    '[분석해 주세요]',
    '- 식사·운동·수면·컨디션에서 보이는 패턴',
    '- 수면과 컨디션, 식사 사이의 관계',
    '- 체중 기록이 있다면 변화 흐름도 함께 봐 주세요',
    ...(advice ? ['- 지난번 조언을 얼마나 따랐는지, 다음에 뭘 조정하면 좋을지'] : []),
    '- 무리하지 않고 오래 지속할 수 있는 방향의 조언',
    '',
    '[답변 형식]',
    '- 마크다운 기호 없이 평범한 문장으로 써 주세요',
    '- 요약은 5문장 이내',
    '- 다음 주에 시도해볼 것을 최대 2개까지 제안해 주세요',
  ].join('\n');
}

$('copy-prompt').addEventListener('click', async () => {
  const r = await shareOrCopy(buildPrompt(), $('prompt-fallback'));
  if (r === 'copied') toast('프롬프트를 복사했어요');
  else if (r !== 'cancelled') shareToast(r);
});

$('save-summary').addEventListener('click', () => {
  const input = $('summary-input');
  const text = input.value.trim();
  if (!text) {
    toast('저장할 내용이 없어요');
    return;
  }
  const dates = periodDates();
  store.addSummary({
    id: store.uid(),
    from: dates[0],
    to: dates[dates.length - 1],
    text,
    savedAt: store.nowISO(),
  });
  input.value = '';
  renderSummaries();
  toast('요약을 저장했어요');
});

function renderSummaries() {
  const ul = $('summary-list');
  ul.innerHTML = '';
  const list = store.getSummaries();
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = '아직 저장된 요약이 없어요.';
    ul.appendChild(li);
    return;
  }
  for (const s of list) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'summary-head';
    const range = document.createElement('span');
    range.textContent = s.from === s.to ? s.from : `${s.from} ~ ${s.to}`;
    const del = document.createElement('button');
    del.className = 'del-btn';
    del.setAttribute('aria-label', '요약 삭제');
    del.textContent = '×';
    del.addEventListener('click', () => {
      store.removeSummary(s.id);
      renderSummaries();
      toast('요약을 삭제했어요');
    });
    head.append(range, del);

    const body = document.createElement('div');
    body.className = 'summary-body';
    body.textContent = s.text;

    li.append(head, body);
    ul.appendChild(li);
  }
}

// ── 설정 탭: 내 정보 ─────────────────────────────────────────
function initProfile() {
  const p = store.getMeta().profile || {};
  $('height').value = p.heightCm || '';
  $('birth-year').value = p.birthYear || '';
  $('target-kg').value = p.targetKg || '';
}
function saveProfile() {
  const profile = {
    heightCm: Number($('height').value) || null,
    birthYear: Number($('birth-year').value) || null,
    targetKg: Number($('target-kg').value) || null,
  };
  store.setMeta({ profile });
  $('profile-nudge').hidden = Boolean(profile.heightCm || profile.birthYear);
}
$('height').addEventListener('change', saveProfile);
$('birth-year').addEventListener('change', saveProfile);
$('target-kg').addEventListener('change', saveProfile);

// ── 설정 탭: 백업 ────────────────────────────────────────────
$('export-btn').addEventListener('click', () => {
  const data = store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diet-backup-${store.dateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('백업 파일을 저장했어요');
});

$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('가져오면 지금 이 기기의 기록이 백업 파일 내용으로 전부 바뀝니다. 계속할까요?')) {
    e.target.value = '';
    return;
  }
  try {
    const data = JSON.parse(await file.text());
    store.importAll(data);
    viewDate = store.dateKey();
    renderDay();
    renderSummaries();
    initProfile();
    toast('백업을 불러왔어요');
  } catch (err) {
    toast(err.message || '불러오지 못했어요');
  }
  e.target.value = '';
});

// ── iOS 홈 화면 추가 안내 배너 ───────────────────────────────
function maybeShowIosBanner() {
  const ua = navigator.userAgent;
  const isIosSafari = /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  const installed = window.navigator.standalone === true;
  if (!isIosSafari || installed) return;
  if (store.getMeta().iosBannerDismissed) return;
  $('ios-banner').hidden = false;
}
$('ios-banner-close').addEventListener('click', () => {
  store.setMeta({ iosBannerDismissed: true });
  $('ios-banner').hidden = true;
});

// ── 서비스 워커 등록 (PWA) ───────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// 공유 시트를 지원하는 기기(대부분 모바일)에서는 문구를 "공유"로 맞춘다
function applyShareLabels() {
  if (!navigator.share) return;
  $('copy-day').textContent = '오늘 기록 공유';
  $('copy-prompt').textContent = '프롬프트 공유';
  $('guide-step1').textContent = '① 기간을 고르고 프롬프트를 공유하세요';
}

// ── 초기화 ───────────────────────────────────────────────────
renderDay();
initProfile();
applyShareLabels();
maybeShowIosBanner();
