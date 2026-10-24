(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = n => n >= 1e9
    ? (n / 1e9).toLocaleString('uk-UA', { maximumFractionDigits: 1 }) + ' млрд ₴'
    : Math.round(n).toLocaleString('uk-UA') + ' ₴';
  const plural = (n, f) => {
    const a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
  };

  /* ---- Меню ---- */
  const header = $('header');
  const toggle = $('#nav-toggle'), nav = $('#site-nav');
  const menuOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const setMenu = open => {
    toggle.setAttribute('aria-expanded', open);
    nav.toggleAttribute('data-open', open);
  };
  toggle.addEventListener('click', () => setMenu(!menuOpen()));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menuOpen()) { setMenu(false); toggle.focus(); }
  });
  $$('header a[href^="#"]').forEach(a => a.addEventListener('click', () => setMenu(false)));
  /* Фокус залишив header: закриваємо меню, щоб воно не перекривало контент */
  header.addEventListener('focusout', e => {
    if (menuOpen() && !header.contains(e.relatedTarget)) setMenu(false);
  });

  /* ---- Вкладки симулятора ---- */
  const tabs = $$('[role="tab"]'), panels = $$('[role="tabpanel"]');
  const RESULT = panels.length - 1;
  const live = $('#sim-live');
  let liveTimer;
  panels.forEach(p => { p.tabIndex = -1; });
  const announce = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (panels[RESULT].hidden) return;
      live.textContent = $('#res-headline').textContent + ': ' + $('#res-total').textContent + '.';
    }, 700);
  };
  const selectTab = (i, focus) => {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', k === i); t.tabIndex = k === i ? 0 : -1; });
    panels.forEach((p, k) => { p.hidden = k !== i; });
    if (focus === 'tab') tabs[i].focus();
    /* На вкладці результату фокус іде на саму панель, а не на кнопку «Зберегти» */
    if (focus === 'panel') (i === RESULT ? panels[i] : $('input, button', panels[i]) || panels[i]).focus();
    if (i === RESULT) announce();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(i));
    t.addEventListener('keydown', e => {
      const keys = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      selectTab((keys[e.key] + tabs.length) % tabs.length, 'tab');
    });
  });
  $$('[data-next]').forEach(b => b.addEventListener('click', () => {
    const cur = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    selectTab(Math.min(cur + 1, tabs.length - 1), 'panel');
  }));

  /* ---- Симулятор ---- */
  const form = $('#sim');
  const val = n => form.elements[n].value;
  let last = null;
  const compute = () => {
    const per = val('incomePeriod') === 'year' ? 12 : 1;
    const save = Math.max(0, +val('income') / per - +val('expenses') / per);
    const months = val('durUnit') === 'years' ? +val('duration') * 12 : +val('duration');
    const r = +val('rate') / 100 / 12;
    const yearly = val('savePeriod') === 'year';
    let bal = 0, dep = 0;
    const pts = [0];
    for (let m = 1; m <= months; m++) {
      bal *= 1 + r;
      if (!yearly) { bal += save; dep += save; }
      else if (m % 12 === 1) { bal += save * 12; dep += save * 12; }
      pts.push(bal);
    }
    return { save, bal, dep, pts, yearly };
  };
  const update = () => {
    const per = val('incomePeriod') === 'year' ? ' на рік' : ' на місяць';
    const d = +val('duration');
    const out = {
      income: money(+val('income')) + per,
      expenses: money(+val('expenses')) + per,
      rate: (+val('rate')).toLocaleString('uk-UA') + ' %',
      duration: d + ' ' + (val('durUnit') === 'years'
        ? plural(d, ['рік', 'роки', 'років'])
        : plural(d, ['місяць', 'місяці', 'місяців']))
    };
    Object.entries(out).forEach(([k, v]) => {
      $('#' + k + '-out').textContent = v;
      form.elements[k].setAttribute('aria-valuetext', v);
    });

    const c = last = compute();
    const save = money(c.save);
    $('#expenses-note').textContent = c.save > 0
      ? 'Ви зможете відкладати близько ' + save + ' щомісяця.'
      : 'Витрати не менші за дохід, тож відкладати нічого. Зменште витрати або збільште дохід.';
    $('#res-headline').textContent = 'Прогноз через ' + out.duration;
    $('#res-total').textContent = money(c.bal);
    $('#res-own').textContent = money(c.dep);
    $('#res-interest').textContent = money(c.bal - c.dep);
    $('#res-note').textContent = c.save > 0
      ? 'Заощадження: ' + save + ' на місяць, ' + (c.yearly ? 'внесок раз на рік.' : 'внесок щомісяця.')
      : 'Наразі заощаджень немає: витрати перевищують дохід.';
    $('#chart-end').textContent = out.duration;

    const W = 600, top = 16, base = 220, max = Math.max(...c.pts, 1), n = c.pts.length - 1;
    const line = c.pts.map((v, i) =>
      (i ? 'L' : 'M') + ((i / n) * W).toFixed(1) + ' ' + (base - (v / max) * (base - top)).toFixed(1)).join(' ');
    $('#chart-line').setAttribute('d', line);
    $('#chart-area').setAttribute('d', line + ' L' + W + ' ' + base + ' L0 ' + base + ' Z');
    announce();
  };
  form.addEventListener('input', update);
  form.addEventListener('submit', e => e.preventDefault());
  update();

  const simStatus = $('#sim-status');
  $('#btn-save').addEventListener('click', () => {
    try {
      localStorage.setItem('potik-monet-plan', JSON.stringify({ ...Object.fromEntries(new FormData(form)), total: Math.round(last.bal) }));
      simStatus.textContent = 'Прогноз збережено в цьому браузері.';
    } catch { simStatus.textContent = 'Не вдалося зберегти: браузер блокує сховище.'; }
  });
  $('#btn-share').addEventListener('click', async () => {
    const text = 'Мій прогноз у «Потік монет»: ' + $('#res-headline').textContent.toLowerCase() + ' — ' + $('#res-total').textContent + '.';
    try {
      if (navigator.share) await navigator.share({ title: 'Потік монет', text, url: location.href });
      else { await navigator.clipboard.writeText(text + ' ' + location.href); simStatus.textContent = 'Посилання скопійовано.'; }
    } catch { simStatus.textContent = 'Поділитись не вдалося. Спробуйте ще раз.'; }
  });

  /* ---- Відгуки ---- */
  const list = $('#review-list'), emptyNote = $('#review-empty');
  const syncEmpty = () => {
    list.hidden = list.children.length === 0;
    emptyNote.hidden = !list.hidden;
  };
  const renderReview = r => {
    const li = document.createElement('li');
    li.className = 'min-w-0';
    const art = document.createElement('article');
    art.className = 'card flex h-full flex-col break-words';
    const stars = document.createElement('div');
    stars.className = 'flex gap-1';
    stars.innerHTML = Array.from({ length: 5 }, (_, i) =>
      '<svg class="ico ' + (i < r.rating ? 'fill-action stroke-action' : 'stroke-line-strong') + '" aria-hidden="true"><use href="#i-star"/></svg>').join('');
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'Оцінка ' + r.rating + ' з 5';
    stars.append(sr);
    const q = document.createElement('blockquote');
    q.className = 'mt-3 grow';
    q.textContent = r.text;
    const foot = document.createElement('footer');
    foot.className = 'mt-4 font-semibold';
    foot.textContent = r.name;
    if (r.role) {
      const s = document.createElement('span');
      s.className = 'block text-sm font-normal text-muted';
      s.textContent = r.role;
      foot.append(s);
    }
    art.append(stars, q, foot);
    li.append(art);
    return li;
  };
  syncEmpty();

  /* ---- Форми: помилки та статуси ---- */
  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const clearInvalid = el => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); };
  const clear = f => $$('[aria-invalid]', f).forEach(clearInvalid);
  const fail = (f, field, msg) => {
    clear(f);
    const s = $('[data-status]', f);
    s.dataset.state = 'error';
    s.textContent = 'Помилка: ' + msg;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', s.id);
    field.focus();
  };
  const ok = (f, msg) => {
    clear(f);
    const s = $('[data-status]', f);
    s.dataset.state = 'ok';
    s.textContent = msg;
  };
  $$('form[novalidate]').forEach(f => f.addEventListener('input', e => {
    if (e.target.hasAttribute('aria-invalid')) clearInvalid(e.target);
  }));

  $('#review-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, d = new FormData(f);
    const name = d.get('name').trim(), text = d.get('text').trim();
    if (!name) return fail(f, f.elements.name, 'вкажіть ім\'я.');
    if (!text) return fail(f, f.elements.text, 'напишіть текст відгуку.');
    list.prepend(renderReview({ name, role: d.get('role').trim(), rating: +d.get('rating'), text }));
    syncEmpty();
    f.reset();
    ok(f, 'Дякуємо! Ваш відгук додано.');
  });

  $('#signup-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, d = new FormData(f);
    if (!d.get('name').trim()) return fail(f, f.elements.name, 'вкажіть ім\'я.');
    if (!emailOk(d.get('email').trim())) return fail(f, f.elements.email, 'введіть коректний email.');
    if (!f.elements.terms.checked) return fail(f, f.elements.terms, 'підтвердіть згоду з умовами.');
    f.reset();
    ok(f, 'Готово! Ми надіслали лист для підтвердження.');
  });

  $('#news-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (!emailOk(f.elements.email.value.trim())) return fail(f, f.elements.email, 'введіть коректний email.');
    f.reset();
    ok(f, 'Дякуємо за підписку!');
  });
})();