/**
 * main.js
 * Інтерактивність сайту «Потік монет» (Vanilla JS, без бібліотек).
 * Валідація й відправка форм живуть у validation.js. Тут усе інше:
 *   1. Мобільне меню
 *   2. Симулятор заощаджень: вкладки, повзунки, розрахунок, графік
 *   3. Збереження прогнозу й «Поділитись»
 *   4. Список відгуків (дані приходять із події "form:submitted" від validation.js)
 *
 * Скрипт підключається з атрибутом defer, тому DOM уже готовий.
 * Усі тексти з користувацьких даних виводяться через textContent.
 */
(() => {
  'use strict';

  /* ========== 0. Налаштування й допоміжні функції ========== */

  const STORAGE_KEYS = {
    scenario: 'potik-monet:scenario',
    reviews: 'potik-monet:reviews',
  };
  const MAX_REVIEWS = 20;
  const MAX_CHART_POINTS = 120;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NBSP = ' ';

  const byId = (id) => document.getElementById(id);

  // Число з розділювачами розрядів: 1 234 567
  const numberFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
  const formatMoney = (value) => numberFormat.format(Math.round(value)) + NBSP + '₴';

  // Правильна форма слова для числа: pluralize(2, 'рік', 'роки', 'років')
  function pluralize(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  // Читає JSON із localStorage; при будь-якій помилці (приватний режим, зіпсовані дані) повертає null
  function readStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  // Записує JSON у localStorage. Повертає false, якщо сховище недоступне.
  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  // Створює елемент із класом і текстом (текст завжди через textContent)
  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  /* ========== 1. Мобільне меню ========== */

  function initNav() {
    const toggle = byId('nav-toggle');
    const nav = byId('site-nav');
    const header = document.querySelector('header');
    if (!toggle || !nav) return;

    const isOpen = () => nav.hasAttribute('data-open');

    function setOpen(open, returnFocus) {
      nav.toggleAttribute('data-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (!open && returnFocus) toggle.focus();
    }

    toggle.addEventListener('click', () => setOpen(!isOpen(), false));

    // Перехід за посиланням меню закриває його
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false, false);
    });

    // Клік поза шапкою закриває меню
    document.addEventListener('click', (event) => {
      if (isOpen() && header && !header.contains(event.target)) setOpen(false, false);
    });

    // Escape закриває меню, якщо фокус у шапці, і повертає фокус на кнопку
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen() && header && header.contains(document.activeElement)) {
        setOpen(false, true);
      }
    });

    // На широкому екрані меню завжди відкрите, тож скидаємо стан
    const wide = window.matchMedia('(min-width: 80rem)');
    wide.addEventListener('change', (event) => {
      if (event.matches) setOpen(false, false);
    });
  }

  /* ========== 2. Симулятор заощаджень ========== */

  function initSimulator() {
    const form = byId('sim');
    if (!form) return;

    // Enter на повзунку чи радіокнопці не має відправляти форму (це перезавантажило б сторінку)
    form.addEventListener('submit', (event) => event.preventDefault());

    const el = {
      incomeOut: byId('income-out'),
      expensesOut: byId('expenses-out'),
      rateOut: byId('rate-out'),
      durationOut: byId('duration-out'),
      expensesNote: byId('expenses-note'),
      headline: byId('res-headline'),
      total: byId('res-total'),
      own: byId('res-own'),
      interest: byId('res-interest'),
      note: byId('res-note'),
      chartLine: byId('chart-line'),
      chartArea: byId('chart-area'),
      chartEnd: byId('chart-end'),
      live: byId('sim-live'),
      status: byId('sim-status'),
    };

    // Остання розрахована симуляція (для збереження й поширення)
    let current = null;

    /* ----- Читання введених даних ----- */

    function readInputs() {
      const f = form.elements;
      return {
        income: Number(f.income.value),
        incomePeriod: f.incomePeriod.value,
        expenses: Number(f.expenses.value),
        rate: Number(f.rate.value),
        savePeriod: f.savePeriod.value,
        duration: Number(f.duration.value),
        durUnit: f.durUnit.value,
      };
    }

    /* ----- Розрахунок ----- */
    /* Складний відсоток із щомісячною капіталізацією.
       «Щомісяця»: внесок наприкінці кожного місяця.
       «Щороку»: один внесок на початку кожного року на суму 12 місячних заощаджень. */

    function calculate(inputs) {
      const months = inputs.durUnit === 'years' ? inputs.duration * 12 : inputs.duration;
      const surplus = inputs.income - inputs.expenses;
      const monthlySavings = surplus > 0
        ? (inputs.incomePeriod === 'year' ? surplus / 12 : surplus)
        : 0;
      const monthlyRate = inputs.rate / 100 / 12;

      let balance = 0;
      let own = 0;
      const series = [0];
      for (let month = 1; month <= months; month += 1) {
        if (inputs.savePeriod === 'year' && (month - 1) % 12 === 0) {
          balance += monthlySavings * 12;
          own += monthlySavings * 12;
        }
        balance *= 1 + monthlyRate;
        if (inputs.savePeriod === 'month') {
          balance += monthlySavings;
          own += monthlySavings;
        }
        series.push(balance);
      }

      return {
        months: months,
        surplus: surplus,
        monthlySavings: monthlySavings,
        deposit: inputs.savePeriod === 'year' ? monthlySavings * 12 : monthlySavings,
        own: own,
        total: balance,
        interest: balance - own,
        series: series,
      };
    }

    /* ----- Тексти ----- */

    const periodSuffix = (period) => (period === 'year' ? ' на рік' : ' на місяць');

    function durationText(duration, unit) {
      const word = unit === 'years'
        ? pluralize(duration, 'рік', 'роки', 'років')
        : pluralize(duration, 'місяць', 'місяці', 'місяців');
      return duration + ' ' + word;
    }

    function summaryText(inputs, result) {
      return 'Потік монет: за ' + durationText(inputs.duration, inputs.durUnit) +
        ' можна накопичити ' + formatMoney(result.total) +
        ' (власні заощадження ' + formatMoney(result.own) +
        ', відсотки ' + formatMoney(result.interest) + ').';
    }

    /* ----- Оновлення інтерфейсу ----- */

    // Значення повзунка видно в <output>, а скрінрідеру віддаємо зрозумілий aria-valuetext
    function setSlider(name, outputEl, text) {
      outputEl.textContent = text;
      form.elements[name].setAttribute('aria-valuetext', text);
    }

    function updateOutputs(inputs) {
      const suffix = periodSuffix(inputs.incomePeriod);
      setSlider('income', el.incomeOut, formatMoney(inputs.income) + suffix);
      setSlider('expenses', el.expensesOut, formatMoney(inputs.expenses) + suffix);
      setSlider('rate', el.rateOut, inputs.rate.toLocaleString('uk-UA') + ' %');
      setSlider('duration', el.durationOut, durationText(inputs.duration, inputs.durUnit));
    }

    function updateExpensesNote(inputs, result) {
      if (result.surplus <= 0) {
        el.expensesNote.textContent =
          'Витрати не менші за дохід, тому відкладати нічого. Зменшіть витрати, щоб побачити прогноз.';
        return;
      }
      const share = Math.round((result.surplus / inputs.income) * 100);
      el.expensesNote.textContent = 'Залишається ' + formatMoney(result.surplus) +
        periodSuffix(inputs.incomePeriod) + ', це ' + share + ' % доходу.';
    }

    function updateResults(inputs, result) {
      el.headline.textContent = 'Через ' + durationText(inputs.duration, inputs.durUnit) +
        ' ви накопичите';
      el.total.textContent = formatMoney(result.total);
      el.own.textContent = formatMoney(result.own);
      el.interest.textContent = formatMoney(result.interest);

      if (result.monthlySavings <= 0) {
        el.note.textContent =
          'Зараз витрати не менші за дохід, тому відкладати нема з чого. Зменшіть витрати на вкладці «Витрати».';
      } else {
        el.note.textContent = 'Ви відкладаєте ' + formatMoney(result.deposit) +
          (inputs.savePeriod === 'year' ? ' щороку' : ' щомісяця') +
          '. Прогноз орієнтовний і не гарантує реальної дохідності.';
      }
      el.chartEnd.textContent = durationText(inputs.duration, inputs.durUnit);
    }

    // Малює лінію й заливку графіка в системі координат SVG 600×240
    function drawChart(series) {
      const width = 600;
      const baseline = 220;
      const top = 20;
      const max = series.reduce((a, b) => (b > a ? b : a), 0);
      const lastIndex = series.length - 1;
      const step = Math.max(1, Math.ceil(lastIndex / MAX_CHART_POINTS));

      const points = [];
      for (let i = 0; i <= lastIndex; i += step) points.push(i);
      if (points[points.length - 1] !== lastIndex) points.push(lastIndex);

      const coords = points.map((i) => {
        const x = (i / lastIndex) * width;
        const y = max > 0 ? baseline - (series[i] / max) * (baseline - top) : baseline;
        return x.toFixed(1) + ' ' + y.toFixed(1);
      });
      const line = 'M' + coords.join(' L');
      el.chartLine.setAttribute('d', line);
      el.chartArea.setAttribute('d', line + ' L' + width + ' ' + baseline + ' L0 ' + baseline + ' Z');
    }

    function update() {
      const inputs = readInputs();
      const result = calculate(inputs);
      updateOutputs(inputs);
      updateExpensesNote(inputs, result);
      updateResults(inputs, result);
      drawChart(result.series);
      current = { inputs: inputs, result: result };
    }

    form.addEventListener('input', update);
    form.addEventListener('change', update);

    /* ----- Вкладки (WAI-ARIA tabs, автоматична активація) ----- */

    const tabs = Array.from(form.querySelectorAll('[role="tab"]'));
    const panels = tabs.map((tab) => byId(tab.getAttribute('aria-controls')));
    panels.forEach((panel) => panel && panel.setAttribute('tabindex', '-1'));

    // focusTarget: 'tab' (фокус на вкладку), 'panel' (на панель) або 'none'
    function selectTab(index, focusTarget) {
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('tabindex', selected ? '0' : '-1');
        if (panels[i]) panels[i].hidden = !selected;
      });
      if (focusTarget === 'tab') tabs[index].focus();
      if (focusTarget === 'panel' && panels[index]) panels[index].focus();

      // На вкладці «Результат» озвучуємо підсумок один раз при відкритті
      const isResult = index === tabs.length - 1;
      el.live.textContent = isResult && current
        ? 'Результат: ' + summaryText(current.inputs, current.result)
        : '';
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(index, 'none'));
    });

    form.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectTab(next, 'tab');
    });

    // Кнопки «Далі» переходять до наступної вкладки й переносять фокус на її панель
    form.querySelectorAll('[data-next]').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = button.closest('[role="tabpanel"]');
        const index = panels.indexOf(panel);
        if (index !== -1 && index < tabs.length - 1) selectTab(index + 1, 'panel');
      });
    });

    /* ----- Збереження прогнозу ----- */

    function setStatus(message, state) {
      if (!el.status) return;
      el.status.textContent = message;
      if (state) el.status.setAttribute('data-state', state);
      else el.status.removeAttribute('data-state');
    }

    function saveScenario() {
      const saved = writeStorage(STORAGE_KEYS.scenario, Object.assign({}, readInputs(), { savedAt: Date.now() }));
      if (saved) setStatus('Прогноз збережено в цьому браузері.', null);
      else setStatus('Не вдалося зберегти: браузер не дає доступу до сховища.', 'error');
    }

    // Відновлює збережений прогноз. Дані зі сховища вважаємо недовіреними: перевіряємо тип і значення.
    function restoreScenario() {
      const data = readStorage(STORAGE_KEYS.scenario);
      if (!data || typeof data !== 'object') return;

      ['income', 'expenses', 'rate', 'duration'].forEach((name) => {
        const value = Number(data[name]);
        // Браузер сам обмежує значення повзунка мінімумом, максимумом і кроком
        if (Number.isFinite(value)) form.elements[name].value = String(value);
      });
      const allowed = { incomePeriod: ['month', 'year'], savePeriod: ['month', 'year'], durUnit: ['years', 'months'] };
      Object.keys(allowed).forEach((name) => {
        if (!allowed[name].includes(data[name])) return;
        form.querySelectorAll('input[name="' + name + '"]').forEach((radio) => {
          radio.checked = radio.value === data[name];
        });
      });
    }

    /* ----- Поділитись ----- */

    async function shareScenario() {
      if (!current) return;
      const text = summaryText(current.inputs, current.result);
      const url = window.location.href.split('#')[0] + '#calculator';

      if (navigator.share) {
        try {
          await navigator.share({ title: 'Потік монет', text: text, url: url });
          setStatus('Дякуємо, що поділились.', null);
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return; // користувач скасував
        }
      }
      // Запасний варіант: копіювання в буфер обміну
      try {
        await navigator.clipboard.writeText(text + ' ' + url);
        setStatus('Текст прогнозу скопійовано в буфер обміну.', null);
      } catch (error) {
        setStatus('Не вдалося поділитись у цьому браузері.', 'error');
      }
    }

    const saveButton = byId('btn-save');
    const shareButton = byId('btn-share');
    if (saveButton) saveButton.addEventListener('click', saveScenario);
    if (shareButton) shareButton.addEventListener('click', shareScenario);

    restoreScenario();
    update();
  }

  /* ========== 3. Відгуки ========== */
  /* Відгуки зберігаються лише в цьому браузері (localStorage). Коли з'явиться сервер,
     замініть loadReviews/saveReviews на запити до API. */

  function initReviews() {
    const list = byId('review-list');
    const empty = byId('review-empty');
    if (!list) return;

    // Приводить дані до безпечного вигляду. Повертає null, якщо відгук некоректний.
    function sanitizeReview(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const name = String(raw.name || '').trim().slice(0, 60);
      const role = String(raw.role || '').trim().slice(0, 60);
      const text = String(raw.text || '').trim().slice(0, 1000);
      const rating = Math.min(5, Math.max(1, Math.round(Number(raw.rating)) || 5));
      const date = Number.isFinite(Number(raw.date)) ? Number(raw.date) : Date.now();
      if (!name || !text) return null;
      return { name: name, role: role, text: text, rating: rating, date: date };
    }

    function loadReviews() {
      const stored = readStorage(STORAGE_KEYS.reviews);
      if (!Array.isArray(stored)) return [];
      return stored.map(sanitizeReview).filter(Boolean).slice(0, MAX_REVIEWS);
    }

    let reviews = loadReviews();

    // Зірка з готового символу #i-star: заповнена або порожня
    function createStar(filled) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', filled ? 'ico text-action fill-current' : 'ico text-line-strong');
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', '#i-star');
      svg.appendChild(use);
      return svg;
    }

    function createCard(review) {
      const card = createElement('li', 'card');
      card.appendChild(createElement('p', 'sr-only', 'Оцінка ' + review.rating + ' з 5'));

      const stars = createElement('div', 'flex gap-1');
      stars.setAttribute('aria-hidden', 'true');
      for (let i = 1; i <= 5; i += 1) stars.appendChild(createStar(i <= review.rating));
      card.appendChild(stars);

      card.appendChild(createElement('p', 'mt-3', review.text));
      card.appendChild(createElement('p', 'mt-4 font-semibold', review.name));
      if (review.role) card.appendChild(createElement('p', 'text-sm text-muted', review.role));

      const time = createElement('time', 'mt-1 block text-sm text-muted',
        new Date(review.date).toLocaleDateString('uk-UA'));
      time.setAttribute('datetime', new Date(review.date).toISOString());
      card.appendChild(time);
      return card;
    }

    function render() {
      const fragment = document.createDocumentFragment();
      reviews.forEach((review) => fragment.appendChild(createCard(review)));
      list.replaceChildren(fragment);
      list.hidden = reviews.length === 0;
      if (empty) empty.hidden = reviews.length > 0;
    }

    // validation.js сповіщає про успішно оброблену форму
    document.addEventListener('form:submitted', (event) => {
      if (!event.detail || event.detail.formId !== 'review-form') return;
      const review = sanitizeReview(Object.assign({}, event.detail.data, { date: Date.now() }));
      if (!review) return;
      reviews = [review].concat(reviews).slice(0, MAX_REVIEWS);
      writeStorage(STORAGE_KEYS.reviews, reviews);
      render();
    });

    render();
  }

  /* ========== Запуск ========== */

  initNav();
  initSimulator();
  initReviews();
})();