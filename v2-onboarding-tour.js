/* First-visit guided tour. Steps are supplied by the app; this module only draws the
   spotlight + callout, moves between steps and remembers (per device) that it was seen. */
window.V2OnboardingTour = {
  create({ steps, switchView, activeView, storage = window.localStorage, onFinish = () => {}, onSkip = () => {} }) {
    const SEEN_KEY = 'tennis.v2.onboardingTourSeen';
    const GUTTER = 16, GAP = 12, PAD = 6;
    let list = [], index = 0, root = null, spot = null, card = null, lastFocus = null, moveRequest = 0;

    const seen = () => { try { return storage.getItem(SEEN_KEY) === '1'; } catch { return false; } };
    const markSeen = () => { try { storage.setItem(SEEN_KEY, '1'); } catch {} };
    const active = () => Boolean(root);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

    function visible(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? el : null;
    }

    function build() {
      root = document.createElement('div');
      root.className = 'tour-root';
      root.innerHTML = `<div class="tour-spot" aria-hidden="true"></div>
        <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourBody" tabindex="-1">
          <p class="tour-step" data-tour-count></p>
          <h2 id="tourTitle" data-tour-title></h2>
          <div id="tourBody" class="tour-body" data-tour-body></div>
          <div class="tour-actions">
            <button type="button" class="tour-skip" data-tour-skip>건너뛰기</button>
            <span class="tour-nav">
              <button type="button" class="tour-prev" data-tour-prev>이전</button>
              <button type="button" class="tour-next" data-tour-next>다음</button>
            </span>
          </div>
        </section>`;
      spot = root.querySelector('.tour-spot');
      card = root.querySelector('.tour-card');
      root.querySelector('[data-tour-skip]').addEventListener('click', () => close(false));
      root.querySelector('[data-tour-prev]').addEventListener('click', () => go(index - 1));
      root.querySelector('[data-tour-next]').addEventListener('click', () => index >= list.length - 1 ? close(true) : go(index + 1));
      // The dimmed page is not clickable while the tour is open.
      root.addEventListener('click', event => { if (event.target === root) card.focus(); });
      document.body.append(root);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
    }

    function onKey(event) {
      if (!root) return;
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); root.querySelector('[data-tour-next]').click(); }
      else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); go(index - 1); }
      else if (event.key === 'Tab') {
        const items = [...card.querySelectorAll('button:not([hidden]), a[href]')].filter(el => el.offsetParent);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }

    function target() {
      const step = list[index];
      return step && step.target ? visible(step.target()) : null;
    }

    function place() {
      if (!root) return;
      const el = target();
      const vw = window.innerWidth, vh = window.innerHeight;
      root.classList.toggle('is-centered', !el);
      if (!el) {
        card.style.left = card.style.top = '';
        return;
      }
      const r = el.getBoundingClientRect();
      const box = { left: Math.max(4, r.left - PAD), top: Math.max(4, r.top - PAD), right: Math.min(vw - 4, r.right + PAD), bottom: Math.min(vh - 4, r.bottom + PAD) };
      Object.assign(spot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const below = vh - box.bottom - GAP, above = box.top - GAP;
      let top = below >= ch + GUTTER || below >= above ? box.bottom + GAP : box.top - GAP - ch;
      top = Math.min(Math.max(GUTTER, top), vh - ch - GUTTER);
      const centre = (box.left + box.right) / 2;
      const left = Math.min(Math.max(GUTTER, centre - cw / 2), vw - cw - GUTTER);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    async function go(next) {
      if (!root || next < 0 || next >= list.length) return;
      const request = ++moveRequest;
      index = next;
      const step = list[index];
      root.classList.add('is-moving');
      if (step.view && activeView() !== step.view) {
        switchView(step.view);
        await wait(380);
      }
      if (request !== moveRequest || !root) return;
      const el = step.target ? visible(step.target()) : null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        await frame();
      }
      if (request !== moveRequest || !root) return;
      render(step);
      await frame();
      place();
      root.classList.remove('is-moving');
      card.focus({ preventScroll: true });
    }

    function render(step) {
      const last = index === list.length - 1;
      root.querySelector('[data-tour-count]').textContent = `${index + 1} / ${list.length}`;
      root.querySelector('[data-tour-title]').textContent = step.title;
      const body = root.querySelector('[data-tour-body]');
      body.replaceChildren();
      for (const text of [].concat(step.body || [])) {
        const p = document.createElement('p');
        p.textContent = text;
        body.append(p);
      }
      if (step.extra) {
        const node = step.extra();
        if (node) body.append(node);
      }
      root.querySelector('[data-tour-prev]').hidden = index === 0;
      root.querySelector('[data-tour-skip]').hidden = last;
      root.querySelector('[data-tour-next]').textContent = index === 0 ? '둘러보기' : last ? '시작하기' : '다음';
    }

    function start() {
      if (root) return;
      list = steps().filter(step => !step.when || step.when());
      if (!list.length) return;
      lastFocus = document.activeElement;
      build();
      go(0);
    }

    function close(finished) {
      if (!root) return;
      moveRequest++;
      markSeen();
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      root.remove();
      root = spot = card = null;
      if (activeView() !== 'dashboard') switchView('dashboard');
      window.scrollTo({ top: 0 });
      (finished ? onFinish : onSkip)(list.map(step => step.id));
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    }

    return { start, seen, active, reposition: place };
  }
};
