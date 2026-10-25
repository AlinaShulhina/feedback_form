/**
 * validation.js
 * Валідація форм, відправка й модальне вікно успіху на Vanilla JavaScript (без бібліотек).
 *
 * Працює з формами: #review-form, #signup-form, #news-form.
 * Правила для поля визначаються за його атрибутом name:
 *   name            -> ім'я (мінімум 2 символи)
 *   email           -> формат email
 *   phone           -> строго +380XXXXXXXXX (необов'язкове, якщо немає атрибута required)
 *   text / message  -> повідомлення (мінімум 10 символів)
 *   terms / consent -> чекбокс згоди (обов'язково checked)
 * Поля з іншими name (role, rating, honeypot) не перевіряються.
 *
 * Очікувана розмітка:
 *   - під кожним перевіреним полем порожній <p id="{id поля}-error" aria-live="polite">;
 *   - для телефону <p id="{id поля}-hint"> (лічильник цифр);
 *   - у кожній формі приховане honeypot-поле name="contact_pref";
 *   - один <dialog id="success-modal"> (див. index.html).
 *
 * Відправка:
 *   SEND_TO_SERVER = false -> демо-режим: дані перевіряються, але нікуди не йдуть,
 *                             у модальному вікні чесний текст про це.
 *   SEND_TO_SERVER = true  -> POST (JSON) на адресу з атрибута action форми.
 *
 * Зв'язок з main.js: після успішної обробки форма генерує подію
 *   "form:submitted" (bubbles) із detail = { formId, data }.
 *
 * Логіка UX:
 *   - Після відкриття сторінки жодних помилок немає.
 *   - Перевірка поля починається після взаємодії з ним (blur або зміна чекбокса).
 *   - blur виконує фінальну перевірку, input оновлює стан уже перевіреного поля.
 *   - submit перевіряє всі поля; модальне вікно з'являється лише після успіху.
 *   - Телефон: ввід не блокується; зі ВСТАВЛЕНОГО фрагмента прибираються лише
 *     пробіли, дужки й дефіси (із повідомленням про це).
 */
(() => {
  'use strict';

  /* ========== 1. Налаштування ========== */

  // true, коли на сервері є endpoint (адреса береться з атрибута action форми)
  const SEND_TO_SERVER = false;
  const REQUEST_TIMEOUT_MS = 15000;

  // Ідентифікатори форм, які потрібно підключити
  const FORM_IDS = ['review-form', 'signup-form', 'news-form'];

  // Мінімальні довжини
  const MIN_NAME_LENGTH = 2;
  const MIN_MESSAGE_LENGTH = 10;

  // Телефон: кількість цифр після +380 і межа довжини, якщо в HTML немає maxlength
  const PHONE_DIGITS_AFTER_CODE = 9;
  const PHONE_FALLBACK_MAX_LENGTH = 30;

  // Регулярні вирази (правила валідації)
  // Email: щось@домен.зона; у домені без порожніх міток («..») і крапки в кінці
  const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
  // Телефон: початок, +380, рівно 9 цифр, кінець (без пробілів, дужок, дефісів)
  const PHONE_REGEX = /^\+380\d{9}$/;

  // Розділювачі, які прибираються зі ВСТАВЛЕНОГО номера:
  // пробіли (включно з нерозривним), дужки, дефіси, тире, мінус
  const PHONE_SEPARATORS_REGEX = /[\s()\-‐-―−]/g;
  // Те саме для перевірки наявності (без прапорця g, щоб test() був стабільним)
  const PHONE_SEPARATOR_TEST = /[\s()\-‐-―−]/;

  // Tailwind-класи станів рамки (єдине джерело стилів помилки й успіху).
  // Рядки написані повністю, щоб Tailwind знайшов їх під час збірки.
  const CLASS_ERROR = 'border-red-500';
  const CLASS_SUCCESS = 'border-green-600';

  // Модальне вікно: id елементів і клас, що блокує прокрутку сторінки
  const MODAL_ID = 'success-modal';
  const MODAL_TITLE_ID = 'success-modal-title';
  const MODAL_TEXT_ID = 'success-modal-text';
  const MODAL_CLOSE_ID = 'success-modal-close';
  const CLASS_SCROLL_LOCK = 'overflow-hidden';

  // Тексти модального вікна. "sent": дані справді відправлені на сервер,
  // "demo": сервера немає, тож текст не обіцяє відправки.
  const MODAL_TEXTS = {
    sent: {
      'review-form': { title: 'Дякуємо за відгук!', text: 'Ваш відгук успішно надіслано.' },
      'signup-form': { title: 'Реєстрацію завершено', text: 'Ваші дані успішно прийнято.' },
      'news-form': { title: 'Підписку оформлено', text: 'Ви успішно підписалися на розсилку.' },
      default: { title: 'Успішно!', text: 'Форму успішно відправлено.' },
    },
    demo: {
      'review-form': { title: 'Дякуємо за відгук!', text: 'Відгук додано до списку на цій сторінці.' },
      default: { title: 'Дані перевірено', text: 'Форму заповнено правильно. Відправку на сервер ще не підключено.' },
    },
  };

  // Статичні тексти повідомлень в одному місці (легко змінити чи локалізувати)
  const MESSAGES = {
    nameEmpty: "Вкажіть, будь ласка, ваше ім'я",
    nameShort: "Ім'я занадто коротке: введіть щонайменше 2 символи",
    emailEmpty: 'Вкажіть email, щоб ми могли вам відповісти',
    emailSpaces: 'Email не має містити пробілів',
    emailNoAt: 'У email бракує символу @. Приклад: name@example.com',
    emailNoDomain: 'Після @ вкажіть домен із крапкою, наприклад example.com',
    emailDots: 'Перевірте домен: не має бути двох крапок поспіль або крапки в кінці',
    emailFormat: 'Перевірте email: він має виглядати так, як name@example.com',
    phoneEmpty: 'Вкажіть телефон у форматі +380501234567',
    phoneSeparators: 'Приберіть пробіли, дужки та дефіси. Приклад: +380501234567',
    phonePlus: 'Знак + має стояти лише на початку номера. Приклад: +380501234567',
    phonePrefix: 'Номер має починатися з +380. Приклад: +380501234567',
    phonePasteNotice: 'З вставленого номера прибрано пробіли, дужки та дефіси.',
    phonePasteTruncated: 'З вставленого номера прибрано розділювачі, але він задовгий і був обрізаний. Перевірте номер.',
    messageEmpty: 'Напишіть, будь ласка, ваше повідомлення',
    consent: 'Щоб продовжити, потрібна ваша згода',
    sending: 'Надсилаємо…',
    sendFailed: 'Не вдалося надіслати форму. Перевірте з’єднання й спробуйте ще раз. Введені дані збережено.',
    formChecked: 'Дякуємо! Дані успішно перевірено.',
    formSent: 'Дякуємо! Форму успішно надіслано.',
  };

  /* ========== 2. Допоміжні функції ========== */

  // Правильна форма слова для числа: pluralize(1, 'символ', 'символи', 'символів')
  function pluralize(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  // Текст: скільки символів ще потрібно додати до повідомлення
  function messageShortText(currentLength) {
    const left = MIN_MESSAGE_LENGTH - currentLength;
    const word = pluralize(left, 'символ', 'символи', 'символів');
    return 'Повідомлення занадто коротке: додайте ще ' + left + ' ' + word +
      ' (мінімум ' + MIN_MESSAGE_LENGTH + ')';
  }

  // Загальний текст про кількість полів із помилками після submit
  function formErrorText(count) {
    const word = pluralize(count, 'поле', 'поля', 'полів');
    return 'Виправте ' + count + ' ' + word + ' та спробуйте ще раз.';
  }

  // Слово «цифра» у потрібній формі
  function digitsWord(count) {
    return pluralize(count, 'цифра', 'цифри', 'цифр');
  }

  /* ========== 3. Валідатори окремих полів ========== */
  /* Кожна функція приймає поле й повертає текст помилки або '' (якщо все гаразд). */

  // Ім'я: не порожнє, щонайменше 2 символи (пробіли по краях не рахуються)
  function validateName(field) {
    const value = field.value.trim();
    if (value.length === 0) return MESSAGES.nameEmpty;
    if (value.length < MIN_NAME_LENGTH) return MESSAGES.nameShort;
    return '';
  }

  // Підказує, що саме не так з email (викликається лише коли формат невалідний)
  function explainEmailError(value) {
    if (/\s/.test(value)) return MESSAGES.emailSpaces;
    if (!value.includes('@')) return MESSAGES.emailNoAt;
    const domain = value.split('@').slice(1).join('@');
    if (!domain.includes('.')) return MESSAGES.emailNoDomain;
    if (/\.\.|^\.|\.$/.test(domain)) return MESSAGES.emailDots;
    return MESSAGES.emailFormat;
  }

  // Email: не порожній, відповідає формату
  function validateEmail(field) {
    const value = field.value.trim();
    if (value.length === 0) return MESSAGES.emailEmpty;
    if (!EMAIL_REGEX.test(value)) return explainEmailError(value);
    return '';
  }

  /* ----- Телефон: діагностика ----- */
  /* Повертає ОДНУ, найкориснішу проблему. Порядок:
     1) недопустимі символи, 2) розділювачі, 3) знак +, 4) префікс, 5) кількість цифр. */

  // Унікальні недопустимі символи (все, крім цифр, +, розділювачів)
  function findInvalidPhoneChars(value) {
    const found = value.match(/[^\d+\s()\-‐-―−]/g) || [];
    return Array.from(new Set(found)).slice(0, 5).join(' ');
  }

  // Підказка щодо префікса: пропонує точний номер, якщо намір зрозумілий
  function explainPhonePrefix(value) {
    // 0501234567 -> +380501234567
    if (/^0\d{9}$/.test(value)) {
      return 'Номер має починатися з +380. Схоже, це ' + value +
        ': введіть його як +38' + value;
    }
    // 380501234567 -> +380501234567
    if (/^380\d+$/.test(value)) {
      return 'Додайте + на початку: +' + value;
    }
    return MESSAGES.phonePrefix;
  }

  // Підказка щодо кількості цифр після +380
  function explainPhoneLength(rest, isRequired) {
    const count = rest.length;
    if (count < PHONE_DIGITS_AFTER_CODE) {
      const left = PHONE_DIGITS_AFTER_CODE - count;
      const base = 'Допишіть ще ' + left + ' ' + digitsWord(left) + ' після +380';
      // Для необов'язкового поля завжди показуємо вихід: очистити поле
      return isRequired ? base : base + ' або очистіть поле, якщо не хочете вказувати телефон';
    }
    const extra = count - PHONE_DIGITS_AFTER_CODE;
    return 'Після +380 має бути рівно ' + PHONE_DIGITS_AFTER_CODE + ' цифр, зараз ' +
      count + ' (зайвих: ' + extra + '). Перевірте номер і видаліть зайві';
  }

  // Пояснює, чому номер не відповідає формату (викликається лише для невалідного значення)
  function explainPhoneError(value, isRequired) {
    const invalidChars = findInvalidPhoneChars(value);
    if (invalidChars) {
      return 'У номері є недопустимі символи: ' + invalidChars +
        '. Після +380 потрібні лише цифри';
    }
    if (PHONE_SEPARATOR_TEST.test(value)) return MESSAGES.phoneSeparators;
    if (value.lastIndexOf('+') > 0 || (value.match(/\+/g) || []).length > 1) {
      return MESSAGES.phonePlus;
    }
    if (!value.startsWith('+380')) return explainPhonePrefix(value);
    return explainPhoneLength(value.slice(4), isRequired);
  }

  // Телефон: строго +380XXXXXXXXX.
  // Порожнє значення допустиме лише якщо поле не має атрибута required.
  function validatePhone(field) {
    const value = field.value.trim();
    if (value.length === 0) {
      return field.required ? MESSAGES.phoneEmpty : '';
    }
    if (!PHONE_REGEX.test(value)) return explainPhoneError(value, field.required);
    return '';
  }

  // Повідомлення: не порожнє, щонайменше 10 символів
  function validateMessage(field) {
    const value = field.value.trim();
    if (value.length === 0) return MESSAGES.messageEmpty;
    if (value.length < MIN_MESSAGE_LENGTH) return messageShortText(value.length);
    return '';
  }

  // Чекбокс згоди: має бути відмічений
  function validateConsent(field) {
    return field.checked ? '' : MESSAGES.consent;
  }

  // Відповідність name поля -> функція перевірки
  const VALIDATORS = {
    name: validateName,
    email: validateEmail,
    phone: validatePhone,
    text: validateMessage,
    message: validateMessage,
    terms: validateConsent,
    consent: validateConsent,
  };

  // Чи є для поля правило (лише власні ключі, без ключів прототипа)
  function hasValidator(field) {
    return Boolean(field && field.name) && Object.hasOwn(VALIDATORS, field.name);
  }

  /* ========== 4. Стан полів і форм ========== */

  // Поля, з якими користувач уже взаємодіяв (blur, зміна чекбокса або submit).
  // Доки поля тут немає, під час введення помилки не показуються.
  const touchedFields = new WeakSet();

  function markTouched(field) {
    touchedFields.add(field);
  }

  function isTouched(field) {
    return touchedFields.has(field);
  }

  // Форми, які зараз надсилаються (захист від подвійної відправки)
  const sendingForms = new WeakSet();
  // Початковий текст кнопки відправки, поки вона показує «Надсилаємо…»
  const submitLabels = new WeakMap();
  // Момент першої взаємодії з формою (для антиспам-евристики на сервері)
  const startedAt = new WeakMap();
  // Форми, у яких зараз показано повідомлення про очищення вставки
  const formsWithPasteNotice = new WeakSet();

  /* ========== 5. Робота з інтерфейсом ========== */

  // Повертає елемент для тексту помилки під полем (id поля + "-error")
  function getErrorElement(field) {
    return document.getElementById(field.id + '-error');
  }

  // Прибирає з рамки поля класи обох станів
  function clearFieldClasses(field) {
    field.classList.remove(CLASS_ERROR, CLASS_SUCCESS);
  }

  // Показує помилку: текст під полем (live-регіон завжди є в DOM), червона рамка, aria
  function showError(field, message) {
    const errorEl = getErrorElement(field);
    clearFieldClasses(field);
    field.classList.add(CLASS_ERROR);
    field.setAttribute('aria-invalid', 'true');
    if (errorEl) errorEl.textContent = message;
  }

  // Показує успіх: зелена рамка, текст помилки прибирається
  function showSuccess(field) {
    const errorEl = getErrorElement(field);
    clearFieldClasses(field);
    field.classList.add(CLASS_SUCCESS);
    field.setAttribute('aria-invalid', 'false');
    if (errorEl) errorEl.textContent = '';
  }

  // Повертає поле в нейтральний стан (без рамок-індикаторів)
  function showNeutral(field) {
    const errorEl = getErrorElement(field);
    clearFieldClasses(field);
    field.setAttribute('aria-invalid', 'false');
    if (errorEl) errorEl.textContent = '';
  }

  // Виводить загальне повідомлення у елемент [data-status]
  function setFormStatus(form, message, state) {
    const statusEl = form.querySelector('[data-status]');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.setAttribute('data-state', state);
  }

  // Очищає загальне повідомлення
  function clearFormStatus(form) {
    const statusEl = form.querySelector('[data-status]');
    if (!statusEl) return;
    statusEl.textContent = '';
    statusEl.removeAttribute('data-state');
  }

  // Якщо після submit усі помилки виправлено, прибирає загальне повідомлення про помилку
  function refreshFormStatus(form) {
    const statusEl = form.querySelector('[data-status]');
    if (!statusEl || statusEl.getAttribute('data-state') !== 'error') return;
    if (!form.querySelector('[aria-invalid="true"]')) clearFormStatus(form);
  }

  // Лічильник символів для textarea з id "{id}-counter" (якщо він є в розмітці)
  function updateCounter(textarea) {
    const counter = document.getElementById(textarea.id + '-counter');
    if (!counter) return;
    const max = textarea.maxLength > 0 ? textarea.maxLength : 1000;
    counter.textContent = textarea.value.length + ' / ' + max;
  }

  function updateCounters(form) {
    form.querySelectorAll('textarea').forEach(updateCounter);
  }

  /* ========== 6. Телефон: підказка-лічильник і вставка ========== */

  // Початковий текст підказки під полем (щоб повертати його назад)
  const phoneHintDefaults = new Map();

  // Повертає елемент підказки під телефоном (id поля + "-hint")
  function getPhoneHint(field) {
    return document.getElementById(field.id + '-hint');
  }

  // Оновлює підказку: «Введено N із 9 цифр» для номера виду +380..., інакше початковий текст
  function updatePhoneHint(field) {
    const hint = getPhoneHint(field);
    if (!hint) return;
    if (!phoneHintDefaults.has(hint)) phoneHintDefaults.set(hint, hint.textContent);

    const value = field.value.trim();
    if (/^\+380\d*$/.test(value)) {
      const count = value.length - 4;
      hint.textContent = count <= PHONE_DIGITS_AFTER_CODE
        ? 'Введено ' + count + ' із ' + PHONE_DIGITS_AFTER_CODE + ' цифр'
        : 'Введено ' + count + ' цифр, потрібно ' + PHONE_DIGITS_AFTER_CODE;
    } else {
      hint.textContent = phoneHintDefaults.get(hint);
    }
  }

  // Прибирає розділювачі з вставленого тексту (цифри й літери лишаються як є)
  function cleanPastedPhone(text) {
    return text.replace(PHONE_SEPARATORS_REGEX, '');
  }

  // Повідомляє, що вставлений номер було змінено. Якщо в формі вже є підсумок
  // помилок, не затираємо його, а пишемо в підказку під полем.
  function showPasteNotice(field, wasTruncated) {
    const form = field.form;
    const message = wasTruncated ? MESSAGES.phonePasteTruncated : MESSAGES.phonePasteNotice;
    const statusEl = form.querySelector('[data-status]');
    if (statusEl && statusEl.getAttribute('data-state') === 'error') {
      const hint = getPhoneHint(field);
      if (hint) hint.textContent = message;
      return;
    }
    setFormStatus(form, message, 'success');
    formsWithPasteNotice.add(form);
  }

  // Прибирає повідомлення про очищення вставки, щойно користувач продовжив редагувати
  function clearPasteNotice(form) {
    if (!formsWithPasteNotice.has(form)) return;
    formsWithPasteNotice.delete(form);
    clearFormStatus(form);
  }

  // Вставка в поле телефону: чистимо лише вставлений фрагмент і лише якщо є що чистити
  function handlePhonePaste(event) {
    const field = event.target;
    if (!field || field.name !== 'phone' || !event.clipboardData) return;

    const pasted = event.clipboardData.getData('text');
    const cleaned = cleanPastedPhone(pasted);
    // Нічого чистити: залишаємо стандартну вставку (maxlength браузер застосує сам)
    if (cleaned === pasted) return;

    event.preventDefault();
    const start = field.selectionStart == null ? field.value.length : field.selectionStart;
    const end = field.selectionEnd == null ? start : field.selectionEnd;

    // setRangeText обходить maxlength, тому місце, що лишилося, рахуємо вручну
    const maxLength = field.maxLength > 0 ? field.maxLength : PHONE_FALLBACK_MAX_LENGTH;
    const room = Math.max(0, maxLength - (field.value.length - (end - start)));
    const piece = cleaned.slice(0, room);
    field.setRangeText(piece, start, end, 'end');

    // Сповіщаємо решту логіки про зміну значення (лічильник, перевірка для touched-поля)
    field.dispatchEvent(new Event('input', { bubbles: true }));
    showPasteNotice(field, piece.length < cleaned.length);
  }

  /* ========== 7. Модальне вікно успіху ========== */
  /* Побудоване на нативному <dialog> і showModal(). Браузер сам забезпечує:
     фокус усередині вікна, неактивну решту сторінки (inert), закриття клавішею Escape
     та шар поверх усього вмісту. Тут додано тексти, блокування прокрутки,
     закриття кнопкою й кліком по затемненню та надійне повернення фокуса. */

  // Елемент, який мав фокус до відкриття (зазвичай кнопка «Надіслати»)
  let modalLastFocused = null;
  // Чи почалося натискання на затемненні (а не всередині вікна)
  let pointerStartedOnBackdrop = false;

  // Повертає частини вікна або null, якщо розмітки немає на сторінці
  function getModalParts() {
    const dialog = document.getElementById(MODAL_ID);
    if (!dialog) return null;
    return {
      dialog: dialog,
      title: document.getElementById(MODAL_TITLE_ID),
      text: document.getElementById(MODAL_TEXT_ID),
      closeButton: document.getElementById(MODAL_CLOSE_ID),
    };
  }

  // Підставляє заголовок і текст (через textContent, тому HTML не інтерпретується)
  function fillModalTexts(parts, formId, mode) {
    const set = MODAL_TEXTS[mode] || MODAL_TEXTS.demo;
    const content = set[formId] || set.default;
    if (parts.title) parts.title.textContent = content.title;
    if (parts.text) parts.text.textContent = content.text;
  }

  // Відкриває вікно. Повертає false, якщо його не можна показати
  // (немає розмітки або браузер не підтримує <dialog>).
  function openSuccessModal(formId, mode) {
    const parts = getModalParts();
    if (!parts || typeof parts.dialog.showModal !== 'function') return false;
    if (parts.dialog.open) return true;

    fillModalTexts(parts, formId, mode);
    modalLastFocused = document.activeElement;
    document.body.classList.add(CLASS_SCROLL_LOCK);
    // showModal() переносить фокус на елемент з autofocus (кнопка «Закрити»)
    parts.dialog.showModal();
    return true;
  }

  // Закриває вікно (подія close далі виконає прибирання)
  function closeSuccessModal() {
    const parts = getModalParts();
    if (parts && parts.dialog.open) parts.dialog.close();
  }

  // Прибирання після закриття будь-яким способом: кнопка, Escape, клік по фону
  function handleModalClose() {
    document.body.classList.remove(CLASS_SCROLL_LOCK);
    // Браузери зазвичай повертають фокус самі. Це страховка, якщо фокус загубився.
    if (
      modalLastFocused &&
      document.contains(modalLastFocused) &&
      document.activeElement !== modalLastFocused
    ) {
      modalLastFocused.focus();
    }
    modalLastFocused = null;
  }

  // Клік по затемненню закриває вікно, лише якщо і натискання, і відпускання
  // були на затемненні (виділення тексту, що закінчилось поза вікном, не закриває його)
  function handleModalPointerDown(event) {
    pointerStartedOnBackdrop = event.target === event.currentTarget;
  }

  function handleModalClick(event) {
    const onBackdrop = event.target === event.currentTarget;
    if (onBackdrop && pointerStartedOnBackdrop) closeSuccessModal();
    pointerStartedOnBackdrop = false;
  }

  // Підключає обробники модального вікна (Escape обробляє браузер)
  function initSuccessModal() {
    const parts = getModalParts();
    if (!parts) return;
    if (parts.closeButton) parts.closeButton.addEventListener('click', closeSuccessModal);
    parts.dialog.addEventListener('pointerdown', handleModalPointerDown);
    parts.dialog.addEventListener('click', handleModalClick);
    parts.dialog.addEventListener('close', handleModalClose);
  }

  // Повідомляє про успішне завершення модальним вікном.
  // Якщо вікна немає або браузер його не підтримує, показуємо статус у формі.
  function showFormSuccess(form, mode) {
    if (openSuccessModal(form.id, mode)) {
      clearFormStatus(form);
    } else {
      setFormStatus(form, mode === 'sent' ? MESSAGES.formSent : MESSAGES.formChecked, 'success');
    }
  }

  /* ========== 8. Логіка перевірки ========== */

  // Перевіряє одне поле. Повертає true, якщо поле валідне (або не підлягає перевірці).
  function validateField(field) {
    if (!hasValidator(field)) return true;

    const message = VALIDATORS[field.name](field);

    if (message) {
      showError(field, message);
      return false;
    }

    // Чекбокс і необов'язкове порожнє поле лишаються нейтральними, без зеленої рамки
    const isCheckbox = field.type === 'checkbox';
    const isEmptyOptional = !isCheckbox && !field.required && field.value.trim() === '';
    if (isCheckbox || isEmptyOptional) {
      showNeutral(field);
    } else {
      showSuccess(field);
    }
    return true;
  }

  // Перевіряє всі поля форми й позначає їх як «перевірені».
  // Повертає масив невалідних полів.
  function validateForm(form) {
    const invalidFields = [];
    // Перевіряємо всі поля, а не зупиняємось на першій помилці
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      if (!hasValidator(field)) return;
      markTouched(field);
      if (!validateField(field)) invalidFields.push(field);
    });
    return invalidFields;
  }

  // Записує в поле «чисте» значення: без пробілів по краях (для імені ще й
  // без подвійних пробілів), щоб на сервер не пішло те, що не пройшло б перевірку
  function normalizeField(field) {
    if (field.type === 'checkbox' || field.tagName === 'SELECT') return;
    let value = field.value.trim();
    if (field.name === 'name') value = value.replace(/\s+/g, ' ');
    if (value !== field.value) field.value = value;
  }

  /* ========== 9. Відправка ========== */

  // Збирає дані форми: текстові значення без пробілів по краях, чекбокси як boolean
  function collectPayload(form) {
    const data = {};
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      if (!field.name) return;
      data[field.name] = field.type === 'checkbox' ? field.checked : field.value.trim();
    });
    // Час від першої взаємодії: сервер може відсіювати занадто швидкі відправки
    data._elapsedMs = startedAt.has(form) ? Date.now() - startedAt.get(form) : 0;
    return data;
  }

  // Починає відлік часу заповнення з першого фокуса у формі
  function trackStart(form) {
    form.addEventListener('focusin', () => startedAt.set(form, Date.now()), { once: true });
  }

  // Вмикає/вимикає стан «Надсилаємо…»: кнопка залишається в фокусі (aria-disabled),
  // але повторні відправки блокуються
  function setSending(form, isSending) {
    const button = form.querySelector('button[type="submit"]');
    if (isSending) {
      sendingForms.add(form);
      form.setAttribute('aria-busy', 'true');
      if (button) {
        submitLabels.set(button, button.textContent);
        button.setAttribute('aria-disabled', 'true');
        button.textContent = MESSAGES.sending;
      }
      setFormStatus(form, MESSAGES.sending, 'pending');
      return;
    }
    sendingForms.delete(form);
    form.removeAttribute('aria-busy');
    if (button && submitLabels.has(button)) {
      button.textContent = submitLabels.get(button);
      submitLabels.delete(button);
      button.removeAttribute('aria-disabled');
    }
    clearFormStatus(form);
  }

  // Відправляє дані на адресу з атрибута action. Ніколи не кидає помилку:
  // повертає { ok } або { ok: false, fieldErrors } для відповіді 422.
  async function sendForm(form, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (response.status === 422) {
        const body = await response.json().catch(() => null);
        return { ok: false, fieldErrors: body && body.errors ? body.errors : null };
      }
      return { ok: response.ok };
    } catch (error) {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  // Успішне завершення: форма очищується, main.js отримує подію, користувач бачить вікно
  function finishSubmit(form, payload, shouldNotify) {
    const mode = SEND_TO_SERVER ? 'sent' : 'demo';
    form.reset();
    resetFormState(form);
    clearFormStatus(form);
    startedAt.delete(form);
    trackStart(form);
    if (shouldNotify) {
      form.dispatchEvent(new CustomEvent('form:submitted', {
        bubbles: true,
        detail: { formId: form.id, data: payload },
      }));
    }
    showFormSuccess(form, mode);
  }

  // Помилка відправки: дані лишаються у формі. Серверні помилки полів (422)
  // показуються під відповідними полями, як і клієнтські.
  function handleSendFailure(form, result) {
    const invalidFields = [];
    if (result.fieldErrors && typeof result.fieldErrors === 'object') {
      Object.keys(result.fieldErrors).forEach((name) => {
        const field = form.elements.namedItem(name);
        const message = result.fieldErrors[name];
        if (field instanceof HTMLElement && hasValidator(field) && typeof message === 'string') {
          markTouched(field);
          showError(field, message);
          invalidFields.push(field);
        }
      });
    }
    if (invalidFields.length > 0) {
      setFormStatus(form, formErrorText(invalidFields.length), 'error');
      invalidFields[0].focus();
      return;
    }
    setFormStatus(form, MESSAGES.sendFailed, 'error');
  }

  /* ========== 10. Обробники подій ========== */

  // submit: зупиняємо стандартну відправку, перевіряємо всі поля, потім відправляємо
  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (sendingForms.has(form)) return;
    formsWithPasteNotice.delete(form);

    const invalidFields = validateForm(form);

    // Є помилки: форму не надсилаємо, фокус на перше невалідне поле
    if (invalidFields.length > 0) {
      setFormStatus(form, formErrorText(invalidFields.length), 'error');
      invalidFields[0].focus();
      return;
    }

    const payload = collectPayload(form);

    // Honeypot заповнили боти: вдаємо успіх, але нічого не відправляємо й не показуємо
    if (payload.contact_pref) {
      finishSubmit(form, payload, false);
      return;
    }

    // Демо-режим: сервера немає, нічого не відправляємо
    if (!SEND_TO_SERVER) {
      finishSubmit(form, payload, true);
      return;
    }

    setSending(form, true);
    const result = await sendForm(form, payload);
    setSending(form, false);

    if (result.ok) {
      finishSubmit(form, payload, true);
    } else {
      handleSendFailure(form, result);
    }
  }

  // Повертає форму у стартовий стан: без індикаторів і без позначок «перевірено»
  function resetFormState(form) {
    form.querySelectorAll('input, textarea, select').forEach((field) => {
      if (!hasValidator(field)) return;
      touchedFields.delete(field);
      showNeutral(field);
      if (field.name === 'phone') updatePhoneHint(field);
    });
    updateCounters(form);
  }

  // blur: фінальна перевірка поля після того, як користувач його залишив
  function handleBlur(event) {
    const field = event.target;
    if (!hasValidator(field)) return;
    // Чекбокс перевіряється при зміні та submit, а не коли повз нього просто пройшли Tab-ом
    if (field.type === 'checkbox') return;
    // Перемикання на інше вікно теж викликає blur, помилку тоді не показуємо
    if (!document.hasFocus()) return;

    markTouched(field);
    normalizeField(field);
    validateField(field);
    refreshFormStatus(field.form);
    if (field.tagName === 'TEXTAREA') updateCounter(field);
  }

  // input: оновлює стан лише для полів, які вже були перевірені.
  // Так помилка не з'являється під час першого набору, але зникає одразу після виправлення.
  function handleInput(event) {
    const field = event.target;
    if (field.tagName === 'TEXTAREA') updateCounter(field);
    if (!hasValidator(field)) return;

    if (field.name === 'phone') {
      updatePhoneHint(field);
      // Повідомлення про очищення вставки показуємо лише до наступної зміни
      if (event.isTrusted) clearPasteNotice(field.form);
    }

    if (!isTouched(field)) return;

    // Телефон: зелене поле, яке користувач почав редагувати й зробив неповним,
    // стає нейтральним, а не червоним. Помилка з'явиться на blur або submit.
    if (field.name === 'phone' && field.classList.contains(CLASS_SUCCESS) && validatePhone(field)) {
      showNeutral(field);
      refreshFormStatus(field.form);
      return;
    }

    validateField(field);
    refreshFormStatus(field.form);
  }

  // change для чекбокса: клік є завершеною дією, тож перевіряємо одразу
  function handleChange(event) {
    const field = event.target;
    if (field.type !== 'checkbox' || !hasValidator(field)) return;
    markTouched(field);
    validateField(field);
    refreshFormStatus(field.form);
  }

  /* ========== 11. Ініціалізація ========== */

  // Підключає всі обробники до однієї форми
  function initForm(form) {
    form.addEventListener('submit', handleSubmit);
    // blur не спливає, тому використовуємо focusout
    form.addEventListener('focusout', handleBlur);
    form.addEventListener('input', handleInput);
    form.addEventListener('change', handleChange);
    form.addEventListener('paste', handlePhonePaste);
    trackStart(form);
  }

  // Запускаємо після завантаження DOM. Жодної перевірки при старті немає.
  function init() {
    FORM_IDS.forEach((id) => {
      const form = document.getElementById(id);
      if (form) initForm(form);
    });
    initSuccessModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();