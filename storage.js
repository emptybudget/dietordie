// storage.js — localStorage 접근을 한곳으로 모으는 모듈.
// 모든 읽기/쓰기는 이 파일을 경유한다 (Phase 2 동기화 교체 지점).

const KEY = {
  meta: 'ddiet:meta',
  day: (date) => `ddiet:day:${date}`,
  summaries: 'ddiet:summaries',
};

const SCHEMA_VERSION = 1;

// ── 저수준 유틸 ───────────────────────────────────────────────
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── 날짜 유틸 ─────────────────────────────────────────────────
// 사용자 로컬 시간 기준 YYYY-MM-DD
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowISO() {
  // 로컬 오프셋을 포함한 ISO 문자열 (예: 2026-07-10T08:12:00+09:00)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

export function uid() {
  return crypto.randomUUID();
}

// ── 마이그레이션 ──────────────────────────────────────────────
// 스키마 버전이 오르면 여기에 단계별 변환을 추가한다.
function migrate() {
  const meta = read(KEY.meta, null);
  if (meta === null) {
    write(KEY.meta, { schemaVersion: SCHEMA_VERSION });
    return;
  }
  // 예시: if (meta.schemaVersion < 2) { ...; meta.schemaVersion = 2; }
  if (meta.schemaVersion !== SCHEMA_VERSION) {
    meta.schemaVersion = SCHEMA_VERSION;
    write(KEY.meta, meta);
  }
}
migrate();

// ── meta ─────────────────────────────────────────────────────
export function getMeta() {
  return read(KEY.meta, { schemaVersion: SCHEMA_VERSION });
}

export function setMeta(patch) {
  const meta = { ...getMeta(), ...patch };
  write(KEY.meta, meta);
  return meta;
}

// ── day ──────────────────────────────────────────────────────
function emptyDay() {
  return {
    meals: [],
    workouts: [],
    sleep: null,
    condition: null,
    note: '',
    updatedAt: null,
  };
}

export function getDay(date) {
  return read(KEY.day(date), null) || emptyDay();
}

// day 전체 저장. updatedAt은 여기서 갱신한다.
export function setDay(date, day) {
  day.updatedAt = nowISO();
  write(KEY.day(date), day);
  return day;
}

// 비어 있는 day는 저장 공간을 차지하지 않도록 지운다.
function isEmptyDay(day) {
  return (
    day.meals.length === 0 &&
    day.workouts.length === 0 &&
    day.sleep === null &&
    day.condition === null &&
    !day.note
  );
}

// day를 콜백으로 변경하고 저장. 변경 결과가 비면 키를 삭제한다.
export function updateDay(date, mutate) {
  const day = getDay(date);
  mutate(day);
  if (isEmptyDay(day)) {
    localStorage.removeItem(KEY.day(date));
    return emptyDay();
  }
  return setDay(date, day);
}

export function hasDay(date) {
  return localStorage.getItem(KEY.day(date)) !== null;
}

// 기록이 있는 모든 날짜 키(YYYY-MM-DD)를 정렬해 반환.
export function allDates() {
  const prefix = 'ddiet:day:';
  const dates = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) dates.push(k.slice(prefix.length));
  }
  return dates.sort();
}

// ── summaries ────────────────────────────────────────────────
export function getSummaries() {
  return read(KEY.summaries, []);
}

export function addSummary(summary) {
  const list = getSummaries();
  list.unshift(summary);
  write(KEY.summaries, list);
  return list;
}

export function removeSummary(id) {
  const list = getSummaries().filter((s) => s.id !== id);
  write(KEY.summaries, list);
  return list;
}

// ── 백업 (설정 탭) ────────────────────────────────────────────
// 앱이 쓰는 모든 키를 한 객체로 모은다.
export function exportAll() {
  const data = { meta: getMeta(), summaries: getSummaries(), days: {} };
  for (const date of allDates()) data.days[date] = getDay(date);
  return data;
}

// 전체 교체(병합 아님). 기존 ddiet:* 키를 모두 지우고 새로 쓴다.
export function importAll(data) {
  if (!data || typeof data !== 'object' || !data.days) {
    throw new Error('올바른 백업 파일이 아닙니다.');
  }
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('ddiet:')) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));

  write(KEY.meta, { ...data.meta, schemaVersion: SCHEMA_VERSION });
  write(KEY.summaries, Array.isArray(data.summaries) ? data.summaries : []);
  for (const [date, day] of Object.entries(data.days)) {
    write(KEY.day(date), day);
  }
}
