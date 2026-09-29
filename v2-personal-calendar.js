/* Personal calendar overlay. The member's own .ics link and its events stay in this browser only. */
(function(root) {
  'use strict';
  const STORAGE_KEY = 'tennis.v2.personalCalendar';
  const STALE_MS = 15 * 60 * 1000;
  const COLORS = ['sky', 'violet', 'pink', 'orange'];
  const DEFAULT_COLOR = COLORS[0];
  const ALLOWED_HOST = /^(calendar\.google\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.icloud\.com|outlook\.live\.com|outlook\.office365\.com)$/i;
  const ERRORS = {
    UNSUPPORTED_URL: '구글 캘린더의 "iCal 형식의 비공개 주소"나 iCloud 공개 캘린더 링크만 연결할 수 있어요.',
    FEED_NOT_FOUND: '캘린더를 찾을 수 없어요. 링크가 바뀌었거나 재설정되지 않았는지 확인해 주세요.',
    FEED_REDIRECT_BLOCKED: '캘린더 링크가 지원하지 않는 주소로 연결돼요.',
    FEED_TOO_LARGE: '캘린더가 너무 커서 불러오지 못했어요.',
    INVALID_ICS: '캘린더 형식을 읽지 못했어요. 링크를 다시 확인해 주세요.',
    ACCESS_DENIED: '접속이 만료됐어요. 새로고침하거나 다시 로그인해 주세요.'
  };
  const pad = n => String(n).padStart(2, '0');
  const monthStart = (date, delta) => {
    const d = new Date(date.getFullYear(), date.getMonth() + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  };

  function normalizeUrl(value) {
    const trimmed = String(value || '').trim().replace(/^webcals?:\/\//i, 'https://');
    let url;
    try { url = new URL(trimmed); } catch { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !ALLOWED_HOST.test(url.hostname)) return '';
    return url.toString();
  }

  function create({
    functionUrl, apiKey, memberId, isEnabled, authHeaders,
    storage = root.localStorage, now = () => Date.now(), fetchImpl = (...args) => root.fetch(...args),
    onChange = () => {}
  }) {
    let loading = false;
    let request = 0;

    function readAll() {
      try {
        const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch { return {}; }
    }
    function writeAll(all) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
    }
    const enabled = () => Boolean(memberId() && isEnabled(memberId()));
    function entry() {
      if (!enabled()) return null;
      const row = readAll()[memberId()];
      return row && typeof row.url === 'string' && row.url ? row : null;
    }
    function save(owner, row) {
      const all = readAll();
      if (row) all[owner] = row; else delete all[owner];
      writeAll(all);
    }

    async function load(url) {
      const today = new Date(now());
      const from = monthStart(today, -2), to = monthStart(today, 13);
      let response;
      try {
        response = await fetchImpl(functionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey, ...(authHeaders() || {}) },
          body: JSON.stringify({ url, from, to })
        });
      } catch {
        throw new Error('캘린더 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
      }
      let data = null;
      try { data = await response.json(); } catch { /* handled below */ }
      if (!response.ok || !data || !Array.isArray(data.events)) {
        throw new Error(ERRORS[data?.code] || '캘린더를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      return { events: data.events, truncated: Boolean(data.truncated), from, to };
    }

    async function connect(rawUrl) {
      if (!enabled()) throw new Error('이 기능은 아직 사용할 수 없어요.');
      const url = normalizeUrl(rawUrl);
      if (!url) throw new Error(ERRORS.UNSUPPORTED_URL);
      const owner = memberId(), id = ++request;
      loading = true; onChange();
      try {
        const result = await load(url);
        if (id !== request || owner !== memberId()) return false;
        save(owner, { url, ...result, fetchedAt: now(), error: '' });
        return true;
      } finally {
        if (id === request) { loading = false; onChange(); }
      }
    }

    async function refresh({ force = false } = {}) {
      const row = entry();
      if (!row || loading) return false;
      if (!force && row.fetchedAt && now() - row.fetchedAt < STALE_MS) return false;
      const owner = memberId(), id = ++request;
      loading = true; onChange();
      try {
        const result = await load(row.url);
        if (id !== request || owner !== memberId()) return false;
        save(owner, { ...row, ...result, fetchedAt: now(), error: '' });
        return true;
      } catch (error) {
        // Keep the last good events so a temporary failure doesn't blank the calendar.
        if (id === request && owner === memberId() && entry()) save(owner, { ...entry(), error: error.message });
        if (force) throw error;
        return false;
      } finally {
        if (id === request) { loading = false; onChange(); }
      }
    }

    function setColor(color) {
      const row = entry();
      if (!row || !COLORS.includes(color)) return false;
      save(memberId(), { ...row, color });
      onChange();
      return true;
    }

    function disconnect() {
      if (!memberId()) return;
      request += 1; loading = false;
      save(memberId(), null);
      onChange();
    }

    function events() {
      const row = entry();
      if (!row || !Array.isArray(row.events)) return [];
      return row.events
        .filter(e => e && typeof e.date === 'string' && typeof e.title === 'string')
        .map(e => ({
          id: String(e.id), date: e.date, title: e.title, location: e.location || '',
          startTime: e.startTime || '', endTime: e.endTime || '', allDay: Boolean(e.allDay),
          category: 'mycal', source: 'personal-calendar', readOnly: true
        }));
    }

    function status() {
      const row = entry();
      return {
        enabled: enabled(), connected: Boolean(row), loading,
        color: COLORS.includes(row?.color) ? row.color : DEFAULT_COLOR,
        fetchedAt: row?.fetchedAt || 0, error: row?.error || '',
        count: Array.isArray(row?.events) ? row.events.length : 0, truncated: Boolean(row?.truncated)
      };
    }

    return { enabled, connect, refresh, disconnect, setColor, events, status };
  }

  const api = { create, normalizeUrl, STORAGE_KEY, COLORS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.V2PersonalCalendar = api;
})(typeof window === 'object' ? window : globalThis);
