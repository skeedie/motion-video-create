// Каталог шаблонов сцен Lyric Studio.
// Каждый шаблон собирает widget-JSON для движка из строки(строк) песни и полей, которые правит пользователь.
// c (контекст сцены): c.part(k, of) -> "$line[a:b]" — k-я часть текста сцены из of частей
//   (по строкам, если строк хватает, иначе слова делятся поровну); c.at(k, of) -> глобальный индекс
//   первого слова этой части (для таймингов); c.all -> "$line"; c.n -> число слов; c.word(i) -> глобальный индекс i-го слова.
(function () {
  const T = [];
  const add = (t) => T.push(t);
  const F = (k, label, def, type = 'text', opts) => ({ k, label, def, type, opts });
  const STRIP = F('strip', 'Текст строки', 'auto', 'select', ['auto', 'note', 'ticker', 'transcript', 'status', 'warn', 'search', 'data', 'none']);
  const strip = (f, def, extra = {}) => {
    const s = f.strip === 'auto' || !f.strip ? def : f.strip;
    if (s === 'none') return undefined;
    return Object.assign({ style: s }, s === 'search' ? { pos: 'top' } : {}, extra);
  };

  // ---------- Переписка ----------
  add({ id: 'chat', name: 'iMessage: я пишу', cat: 'Переписка', lines: 2,
    fields: [F('name', 'Контакт', 'Она 💕'), F('emoji', 'Аватар', '💕', 'emoji'), F('color', 'Цвет аватара', '#FF2D55', 'color'), F('img', 'Фото (вместо эмодзи)', '', 'image'), F('reply', 'Ответ в конце (пусто — без ответа)', '👀'), F('keyboard', 'Клавиатура', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'chat', name: f.name, avatar: { emoji: f.emoji, img: f.img || undefined, color: `linear-gradient(180deg,${f.color}99,${f.color})` }, keyboard: !!f.keyboard, height: 540, scale: 1.27,
      msgs: [{ me: true, text: c.part(0, 2), at: c.at(0, 2) }, { me: true, text: c.part(1, 2), at: c.at(1, 2) }].concat(f.reply ? [{ text: f.reply, at: 'end-0.5' }] : []) } }) });

  add({ id: 'tg-her', name: 'Telegram: пишет она', cat: 'Переписка', lines: 2,
    fields: [F('name', 'Контакт', 'Она 💕'), F('emoji', 'Аватар', '💕', 'emoji'), F('status', 'Статус', 'в сети'), F('time', 'Время', '03:12'), F('img', 'Фото (вместо эмодзи)', '', 'image')],
    make: (f, c) => ({ widget: { type: 'tg', name: f.name, avatar: { emoji: f.emoji, img: f.img || undefined, color: 'linear-gradient(180deg,#FF8FB1,#FF2D55)' }, status: f.status, typing_until: 'start', height: 420, scale: 1.3,
      msgs: [{ text: c.part(0, 2), at: c.at(0, 2), time: f.time }, { text: c.part(1, 2), at: c.at(1, 2), time: f.time }] } }) });

  add({ id: 'tg-group', name: 'Telegram: групповой чат', cat: 'Переписка', lines: 1,
    fields: [F('name', 'Название чата', 'houmie 🌿'), F('emoji', 'Аватар', '🌿', 'emoji'),
      F('n1', 'Друг 1', 'leartz'), F('m1', 'Сообщение 1', 'а скок раз мы уже дунули?'),
      F('n2', 'Друг 2', 'vissking'), F('m2', 'Сообщение 2', 'бро, где-то 432 раза за неделю'),
      F('n3', 'Друг 3', '432hz'), F('m3', 'Сообщение 3', 'пора бы бросать ваще.'), F('img', 'Фото чата', '', 'image')],
    make: (f, c) => ({ widget: { type: 'tg', name: f.name, avatar: { emoji: f.emoji, img: f.img || undefined, color: 'linear-gradient(180deg,#9BE15D,#00B36B)' }, status: 'участников: 4', typing_until: 'start', height: 470, scale: 1.3,
      msgs: [[f.n1, f.m1, '#E0567A'], [f.n2, f.m2, '#2A9DF4'], [f.n3, f.m3, '#8B3DFF']].filter(x => x[1]).map(x => ({ from: x[0], fromColor: x[2], text: x[1], at: { t: 0 }, time: '04:20' }))
        .concat([{ me: true, text: c.all, at: c.at(0, 1), time: '04:21' }]) } }) });

  add({ id: 'tg-feed', name: 'Telegram: прокрутка по дням', cat: 'Переписка', lines: 1,
    fields: [F('name', 'Контакт', 'Она 💕'), F('texts', 'Сообщения по кругу (через |)', 'ты дурак!|ты дурак!!|дурак 🙄'), F('react', 'Реакция', '🤡', 'emoji'), F('img', 'Фото (вместо эмодзи)', '', 'image'), STRIP],
    make: (f, c) => ({ widget: { type: 'tgfeed', name: f.name, avatar: { emoji: '💕', img: f.img || undefined, color: 'linear-gradient(180deg,#FF8FB1,#FF2D55)' }, status: 'в сети', texts: f.texts.split('|'), at: c.word(0), dur: 1.1,
      accent_at: c.word(Math.floor(c.n / 2)), react: f.react, react_at: c.word(Math.max(0, c.n - 2)), height: 380, scale: 1.3, lyric: strip(f, 'note', { icon: '🙄' }) } }) });

  add({ id: 'notifs', name: 'Экран блокировки + уведомления', cat: 'Переписка', lines: 2,
    fields: [F('time', 'Время', '13:37'), F('date', 'Дата', 'понедельник, 2 ноября'), F('app1', 'Приложение 1', 'Будильник'), F('ic1', 'Значок 1', '⏰', 'emoji'),
      F('app2', 'Приложение 2', 'Telegram'), F('ic2', 'Значок 2', '💬', 'emoji'), F('title2', 'Заголовок 2', '')],
    make: (f, c) => ({ widget: { type: 'notifs', lock: { date: f.date, time: f.time }, scale: 1.18,
      items: [{ app: f.app1, icon: f.ic1, color: '#FF9F0A', text: c.part(0, 2), at: c.at(0, 2) }, { app: f.app2, icon: f.ic2, color: '#2AABEE', title: f.title2 || undefined, text: c.part(1, 2), at: c.at(1, 2) }] } }) });

  add({ id: 'call', name: 'Входящий звонок', cat: 'Переписка', lines: 2,
    fields: [F('name', 'Кто звонит', 'Она 💕'), F('emoji', 'Аватар', '💕', 'emoji'), F('sub', 'Подпись', 'входящий вызов'), F('after', 'Подпись после ответа', 'соединение…'), F('img', 'Фото (вместо эмодзи)', '', 'image'), STRIP],
    make: (f, c) => ({ widget: { type: 'call', style: 'card', name: f.name, sub: f.sub, avatar: { emoji: f.emoji, img: f.img || undefined, color: 'linear-gradient(180deg,#FF8FB1,#FF2D55)' }, decline: 'Позже', at: c.word(0),
      end: { at: c.word(Math.max(0, c.n - 1)), action: 'accept', sub: f.after }, scale: 1.3, lyric: strip(f, 'status', { icon: '📞' }) } }) });

  add({ id: 'typing', name: 'Тёмная карточка: печатает строку', cat: 'Переписка', lines: 1,
    fields: [F('emoji', 'Эмодзи в конце', '✨', 'emoji')],
    make: (f, c) => ({ widget: { type: 'typing', text: c.all, emoji: f.emoji, emoji_at: 'end-0.4', scale: 1.3 } }) });

  // ---------- Документы ----------
  add({ id: 'doc', name: 'Справка / документ с печатью', cat: 'Документы', lines: 2,
    fields: [F('org', 'Организация', 'Минздрав · Поликлиника № 420'), F('title', 'Заголовок', 'СПРАВКА'), F('patient', 'Пациент', 'melhor'),
      F('l1', 'Поле для 1-й строки', 'Жалобы'), F('l2', 'Поле для 2-й строки', 'Назначение'),
      F('hl1', 'Выделенное поле: название', 'Диагноз'), F('hv1', 'Выделенное поле: текст', 'больное горло'),
      F('hl2', 'Второе выделение: название', 'Лечение'), F('hv2', 'Второе выделение: текст', 'шишки 🌿'),
      F('seal', 'Текст печати', 'ВРАЧ'), F('sealColor', 'Цвет печати', '#2546C8', 'color')],
    make: (f, c) => ({ widget: { type: 'doc', org: f.org, title: f.title, form: 'форма № 095/у', date: 'выдана сегодня', doctor: 'Врач: ____________', sign: '',
      rows: [{ label: 'Пациент', value: f.patient }, { label: f.l1, value: c.part(0, 2) }, f.hv1 ? { label: f.hl1, value: f.hv1, hl: 'rgba(255,90,90,.45)', at: c.at(0, 2) + 1 } : null,
        { label: f.l2, value: c.part(1, 2) }, f.hv2 ? { label: f.hl2, value: f.hv2, hl: 'rgba(74,222,128,.55)', at: c.at(1, 2) } : null].filter(Boolean),
      seal_at: c.word(Math.max(0, c.n - 2)), sealMid: f.seal, sealColor: f.sealColor, sealRight: 12, sealBottom: -24, scale: 1.3 } }) });

  add({ id: 'record', name: 'Медкарта / анкета', cat: 'Документы', lines: 1,
    fields: [F('title', 'Заголовок', 'Медкарта'), F('name', 'Имя', 'melhor'), F('r1', 'Строка 1: поле', 'горло'), F('v1', 'Строка 1: значение', 'болит'),
      F('r2', 'Строка 2: поле', 'назначено'), F('v2', 'Строка 2: значение', 'лечиться 💊'), STRIP],
    make: (f, c) => ({ widget: { type: 'record', title: f.title, icon: '🩺', color: '#FF3B30', name: f.name, sub: 'приём сегодня', avatar: { emoji: '🤒', color: 'linear-gradient(180deg,#FFD66B,#FF9F0A)' },
      rows: [{ label: f.r1, value: f.v1, mark: '✕', markColor: '#FF3B30', at: c.word(1) }, { label: f.r2, value: f.v2, mark: '✓', markColor: '#16A34A', at: c.word(Math.floor(c.n / 2)) }],
      scale: 1.3, lyric: strip(f, 'note', { icon: '🤒' }) } }) });

  add({ id: 'list', name: 'Список / рацион с метками', cat: 'Документы', lines: 3,
    fields: [F('title', 'Заголовок', 'Рацион'), F('sub', 'Подзаголовок', 'сегодня · доставка'), F('right', 'Справа', '−780 ₽'),
      F('i1', 'Значок 1', '💜', 'emoji'), F('t1', 'Метка 1', 'от горла'), F('i2', 'Значок 2', '🟤', 'emoji'), F('t2', 'Метка 2', 'мне'), F('i3', 'Значок 3', '🍜', 'emoji'), F('t3', 'Метка 3', 'тебе')],
    make: (f, c) => ({ widget: { type: 'list', title: f.title, sub: f.sub, right: f.right, rightColor: '#FF3B30', scale: 1.3,
      rows: [0, 1, 2].map(k => ({ icon: f['i' + (k + 1)], color: '#F2F2F7', text: c.part(k, 3), tag: f['t' + (k + 1)] || undefined })) } }) });

  add({ id: 'todo', name: 'Список дел с галочками', cat: 'Документы', lines: 1,
    fields: [F('title', 'Заголовок', 'Перед встречей'), F('i1', 'Пункт 1', 'Душ 🚿'), F('i2', 'Пункт 2', 'Поменять носки 🧦'), F('stamp', 'Штамп в конце (пусто — без)', 'Готов ✓'), STRIP],
    make: (f, c) => ({ widget: { type: 'todo', title: f.title, color: '#FF9F0A', scale: 1.35, items: [{ text: f.i1, at: c.word(1) }, { text: f.i2, at: c.word(Math.floor(c.n * 0.6)) }],
      progress: { label: 'Готовность', at: c.word(0), to: 100, dur: 1 }, lyric: strip(f, 'search') },
      punch: f.stamp ? [{ word: f.stamp, at: c.word(Math.floor(c.n * 0.6)), style: 'stamp', color: '#16A34A', top: 150, right: 24, size: 26, rot: -9 }] : undefined }) });

  // ---------- Игры / вайб ----------
  add({ id: 'cs-bomb', name: 'Бомба: таймер и дефуз', cat: 'Игры', lines: 2,
    fields: [F('label', 'Надпись', 'БОМБА ЗАЛОЖЕНА · B'), F('site', 'Справа', 'РАУНД 1'), F('kit', 'Значок дефуза', '🧰', 'emoji'), F('from', 'Таймер с (сек)', 7.4, 'number')],
    make: (f, c) => ({ widget: { type: 'bomb', title: c.part(0, 2), defuse: c.part(1, 2), at: c.word(0), from: +f.from, to: 0.9, defuse_at: c.at(1, 2), defuse_dur: 1.0, kit: f.kit, label: f.label, site: f.site, scale: 1.3 } }) });

  add({ id: 'cs-score', name: 'Счёт матча + «раунд проигран»', cat: 'Игры', lines: 2,
    fields: [F('b', 'Вторая команда', 'melhor'), F('ae', 'Значок 1-й команды', '🌿', 'emoji'), F('be', 'Значок 2-й команды', '🎧', 'emoji'), F('sa', 'Счёт 1-й', 1, 'number'), F('sb', 'Счёт 2-й', 0, 'number'), F('label', 'Баннер', 'РАУНД ПРОИГРАН')],
    make: (f, c) => ({ widget: { type: 'score', a: { name: c.part(0, 2), emoji: f.ae, color: 'linear-gradient(135deg,#22C55E,#15803D)', from: 0, to: +f.sa }, b: { name: f.b, emoji: f.be, color: 'linear-gradient(135deg,#F5A623,#D97706)', to: +f.sb },
      at: c.word(Math.max(0, c.at(1, 2) - 1)), banner: c.part(1, 2), banner_at: c.at(1, 2), bannerLabel: f.label, scale: 1.3 } }) });

  add({ id: 'selfhit', name: 'Крит-урон по мне', cat: 'Игры', lines: 2,
    fields: [F('label', 'Счётчик: подпись', 'КОЛИЧЕСТВО'), F('to', 'Счётчик до', 1337000, 'number'), F('suffix', 'Единица', '₽'), F('roll', 'Действие (полоска)', 'кручу блант'), F('name', 'Игрок', 'melhor'), F('dmg', 'Урон', '−97')],
    make: (f, c) => ({ widget: { type: 'selfhit', label: f.label, badge: '▲ важно', to: +f.to, suffix: f.suffix, at: c.word(0), dur: 1.2, text1: c.part(0, 2), text2: c.part(1, 2),
      rollLabel: f.roll, roll_at: c.at(1, 2), damage_at: c.word(Math.max(c.at(1, 2), c.n - 2)), selfName: f.name, selfIcon: '🧢', hp: 100, hpTo: 3, dmg: f.dmg, scale: 1.3 } }) });

  add({ id: 'achievement', name: 'Достижение получено', cat: 'Игры', lines: 1,
    fields: [F('label', 'Надпись', 'Достижение'), F('xp', 'XP', 420, 'number')],
    make: (f, c) => ({ widget: { type: 'achievement', style: 'game', text: c.all, label: f.label, icon: 'bolt', xp: +f.xp, from: 20, at: c.word(0), dur: 1.0, scale: 1.25 } }) });

  add({ id: 'purchase', name: 'Приглашение / покупка: отклонить', cat: 'Игры', lines: 1,
    fields: [F('label', 'Надпись', 'Приглашение в игру'), F('item', 'Что', 'Её игры 🎲'), F('sub', 'Подпись', 'Для: тебя'), F('action', 'Нажать', 'decline', 'select', ['decline', 'approve'])],
    make: (f, c) => ({ widget: { type: 'purchase', label: f.label, item: f.item, sub: f.sub, initial: '🎲', text: c.all, action: f.action === 'decline' ? 'decline' : undefined, approve_at: c.word(c.n - 1), scale: 1.3 } }) });

  // ---------- Цифры ----------
  add({ id: 'counter', name: 'Счётчик + график', cat: 'Цифры', lines: 2,
    fields: [F('app', 'Приложение', 'Привычки'), F('icon', 'Значок', '🔥', 'emoji'), F('to', 'Число', 365, 'number'), F('suffix', 'Единица', ''), F('graph', 'График', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'counter', app: f.app, icon: f.icon, color: '#16A34A', label: c.part(0, 2), from: 0, to: +f.to, suffix: f.suffix ? ' ' + f.suffix : '', at: c.word(0), dur: 1.1, graph: !!f.graph,
      footer: { icon: 'check', text: c.part(1, 2) }, scale: 1.3 } }) });

  add({ id: 'alert', name: 'Батарея садится', cat: 'Цифры', lines: 2,
    fields: [F('from', 'Заряд с %', 18, 'number'), F('b2', 'Кнопка', 'Энергосбережение')],
    make: (f, c) => ({ widget: { type: 'alert', title: c.part(0, 2), text: c.part(1, 2), from: +f.from, to: 1, at: c.word(0), dur: 1.0, b1: 'Закрыть', b2: f.b2, tap_at: c.word(c.n - 1), scale: 1.3 } }) });

  add({ id: 'poll', name: 'Опрос с процентами', cat: 'Цифры', lines: 1,
    fields: [F('q', 'Вопрос', 'Рискну ли я?'), F('o1', 'Вариант 1', 'Да 🔥'), F('p1', '% 1', 88, 'number'), F('o2', 'Вариант 2', 'Нет'), F('p2', '% 2', 12, 'number'), STRIP],
    make: (f, c) => ({ widget: { type: 'poll', label: 'опрос', q: f.q, scale: 1.35,
      opts: [{ text: f.o1, to: +f.p1, color: '#8B3DFF', at: c.word(0), pick_at: c.word(Math.max(0, c.n - 2)) }, { text: f.o2, to: +f.p2, color: '#636366', at: c.word(0) }], lyric: strip(f, 'ticker', { label: 'Сейчас: ' }) } }) });

  add({ id: 'slider', name: 'Ползунок «уровень»', cat: 'Цифры', lines: 1,
    fields: [F('title', 'Заголовок', 'Уровень риска'), F('sub', 'Подпись', ''), F('to', 'До (0–1)', 0.92, 'number'), F('t1', 'Слева', 'осторожно'), F('t3', 'Справа', 'безумие'), STRIP],
    make: (f, c) => ({ widget: { type: 'slider', title: f.title, sub: f.sub, from: 0.15, to: +f.to, min: 0, max: 100, decimals: 0, suffix: '%', ticks: [f.t1, '', f.t3], color: '#B57BFF', at: c.word(0), end_at: c.word(c.n - 1), scale: 1.35,
      lyric: strip(f, 'transcript', { label: 'Мысли' }) } }) });

  add({ id: 'pulse', name: 'Пульс с ЭКГ', cat: 'Цифры', lines: 1,
    fields: [F('title', 'Заголовок', 'Пульс'), F('v1', 'Пульс с', 72, 'number'), F('v2', 'Пульс до', 148, 'number'), STRIP],
    make: (f, c) => ({ widget: { type: 'pulse', title: f.title, values: [{ at: null, v: +f.v1 }, { at: c.word(Math.floor(c.n / 2)), v: +f.v2 }], scale: 1.4, lyric: strip(f, 'data', { label: 'ЭКГ · ' }) } }) });

  add({ id: 'rating', name: 'Рейтинг со звёздами', cat: 'Цифры', lines: 1,
    fields: [F('name', 'Кого оценивают', 'Я'), F('sub', 'Подпись', 'отзывы'), F('icon', 'Значок', '🤡', 'emoji'), F('value', 'Оценка', 1.0, 'number'), STRIP],
    make: (f, c) => ({ widget: { type: 'rating', name: f.name, sub: f.sub, icon: f.icon, color: 'linear-gradient(135deg,#FFD66B,#FF9F0A)', value: +f.value, from: 5, dist: [0.05, 0.05, 0.1, 0.2, 0.95], at: c.word(1), scale: 1.35,
      lyric: strip(f, 'data', { label: 'Отзыв · ' }) } }) });

  add({ id: 'bank', name: 'Банковская карта', cat: 'Цифры', lines: 1,
    fields: [F('holder', 'Имя на карте', 'melhor'), F('text', 'Надпись на карте', 'карты говорят'), F('accent', 'Выделить слово', 'говорят'), F('num', 'Номер', '•••• 0666'), STRIP],
    make: (f, c) => ({ widget: { type: 'bank', holder: f.holder, number: f.num, text: f.text, accent: f.accent, accentColor: '#E9D5FF', bg: 'linear-gradient(135deg,#3B1C6E 0%,#160A2B 60%,#2A1150 100%)', glow: 'rgba(180,110,255,.45)', at: c.word(0), scale: 1.25,
      lyric: strip(f, 'transcript', { label: 'Расклад' }) } }) });

  add({ id: 'spend', name: 'Доставка / корзина', cat: 'Цифры', lines: 2,
    fields: [F('title', 'Заголовок', 'Доставка'), F('i1', 'Значок 1', '🚬', 'emoji'), F('s1', 'Подпись 1', 'пачка · 20 шт'), F('a1', 'Цена 1', 289, 'number'), F('i2', 'Значок 2', '🧴', 'emoji'), F('s2', 'Подпись 2', 'бутылка 0,5 л'), F('a2', 'Цена 2', 49, 'number')],
    make: (f, c) => ({ widget: { type: 'spend', title: f.title, sub: 'заказ · 15 мин', cur: '₽', scale: 1.3,
      items: [{ icon: f.i1, color: '#FFF4D6', name: c.part(0, 2), sub: f.s1, amount: +f.a1, at: c.at(0, 2) }, { icon: f.i2, color: '#E6F3FF', name: c.part(1, 2), sub: f.s2, amount: +f.a2, at: c.at(1, 2) }] } }) });

  // ---------- Состояние ----------
  add({ id: 'toggles', name: 'Тумблеры: каждая строка — переключатель', cat: 'Состояние', lines: 2,
    fields: [F('i1', 'Значок 1', '🍃', 'emoji'), F('s1', 'Подпись 1', 'в наличии'), F('i2', 'Значок 2', '🌙', 'emoji'), F('s2', 'Подпись 2', 'тихий режим')],
    make: (f, c) => ({ widget: { type: 'toggles', scale: 1.35, rows: [
      { icon: f.i1, color: '#16A34A', title: c.part(0, 2), sub: f.s1, on: false, at: c.at(0, 2), to: true },
      { icon: f.i2, color: '#5E5CE6', title: c.part(1, 2), sub: f.s2, on: false, at: c.at(1, 2), to: true, onColor: '#5E5CE6' }] } }) });

  add({ id: 'segmented', name: 'День / Ночь переключатель', cat: 'Состояние', lines: 1,
    fields: [F('o1', 'Слева', 'День ☀️'), F('o2', 'Справа', 'Ночь 🌙'), F('row', 'Тумблер снизу', 'Дунуть'), F('ri', 'Значок тумблера', '💨', 'emoji'), STRIP],
    make: (f, c) => ({ widget: { type: 'segmented', opts: [f.o1, f.o2], sel: 0, events: [{ at: c.word(0), sel: 0 }, { at: c.word(Math.floor(c.n / 2)), sel: 1 }], row: { icon: f.ri, color: '#8B3DFF', title: f.row, at: c.word(c.n - 1) }, scale: 1.45,
      lyric: strip(f, 'ticker', { label: 'Режим: ' }) } }) });

  add({ id: 'weather', name: 'Погода: строка = место и прогноз', cat: 'Состояние', lines: 2,
    fields: [F('temp', 'Температура', 7, 'number'), F('emoji', 'Погода', '🌫️', 'emoji'), F('bg', 'Фон', '#6B7280', 'color')],
    make: (f, c) => ({ widget: { type: 'weather', city: c.part(0, 2), temp: +f.temp, from: 21, emoji: f.emoji, text: c.part(1, 2), hours: ['сейчас', 'днём', 'вечером', 'ночью'], bg: `linear-gradient(180deg,${f.bg} 0%,#B8C2D1 100%)`, at: c.word(0), scale: 1.4 } }) });

  add({ id: 'leanrain', name: 'Дождь из лина', cat: 'Состояние', lines: 1,
    fields: [F('city', 'Место', 'Улица'), F('text', 'Погода', 'Дождь из лина 💜'), STRIP],
    make: (f, c) => ({ widget: { type: 'leanrain', city: f.city, text: f.text, at: c.word(0), scale: 1.35, lyric: strip(f, 'ticker', { label: 'Сейчас: ' }) } }) });

  add({ id: 'recorder', name: 'Диктофон: идёт запись', cat: 'Состояние', lines: 1,
    fields: [F('title', 'Название записи', 'Фристайл'), F('sub', 'Подпись', 'Запись · сегодня'), STRIP],
    make: (f, c) => ({ widget: { type: 'recorder', title: f.title, sub: f.sub, at: c.word(0), scale: 1.35, lyric: strip(f, 'transcript', { label: 'Расшифровка' }) } }) });

  add({ id: 'player', name: 'Плеер: строка = название трека', cat: 'Музыка', lines: 1,
    fields: [F('artist', 'Артист', 'melhor'), F('emoji', 'Обложка', '🌿', 'emoji'), F('img', 'Обложка-картинка', '', 'image')],
    make: (f, c) => ({ widget: { type: 'player', title: c.all, artist: f.artist, emoji: f.emoji, img: f.img || undefined, scale: 1.45 } }) });

  // ---------- Дорога ----------
  add({ id: 'drive', name: 'Дорога: машина едет мимо', cat: 'Дорога', lines: 2,
    fields: [F('items', 'Метки по пути (через пробел)', '👀 🌃 🎉 🍾 💸 🏙️'), F('car', 'Машина', '🚗', 'emoji'), F('stops', 'Справа снизу', 'остановок: 0')],
    make: (f, c) => ({ widget: { type: 'drive', title: c.part(0, 2), sub: c.part(1, 2), items: f.items.split(/\s+/).filter(Boolean), car: f.car, at: c.word(0), end_at: 'end-0.1', color: '#16A34A', stops: f.stops, scale: 1.35 } }) });

  add({ id: 'map', name: 'Карта: маршрут с поворотами', cat: 'Дорога', lines: 2,
    fields: [F('button', 'Кнопка', 'Поехали 🏁'), F('curvy', 'Извилистый путь', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'map', mode: 'route', path: f.curvy ? 'M40 215 C110 215 70 150 140 140 C220 128 150 70 230 62 C310 54 260 20 330 22 L410 24' : undefined,
      title: c.part(0, 2), sub: c.part(1, 2), button: f.button, at: c.word(0), end_at: 'end-0.3', move_at: c.word(0), move_dur: 2.4, scale: 1.3 } }) });

  // ---------- 0.2: новые шаблоны ----------
  const AV = (f, emoji, color) => ({ emoji: f.emoji || emoji, img: f.img || undefined, color });
  add({ id: 'imsg-dialog', name: 'iMessage: диалог (она → я)', cat: 'Переписка', lines: 2,
    fields: [F('name', 'Контакт', 'Она 💕'), F('emoji', 'Аватар', '💕', 'emoji'), F('img', 'Фото (вместо эмодзи)', '', 'image'), F('status', 'Подпись под моим', 'Прочитано')],
    make: (f, c) => ({ widget: { type: 'chat', name: f.name, avatar: AV(f, '💕', 'linear-gradient(180deg,#FF8FB199,#FF2D55)'), height: 420, scale: 1.27,
      msgs: [{ text: c.part(0, 2), at: c.at(0, 2) }, { me: true, text: c.part(1, 2), at: c.at(1, 2), status: f.status || undefined, status_at: 'end-0.9' }] } }) });

  add({ id: 'callfull', name: 'Звонок на весь экран', cat: 'Переписка', lines: 1,
    fields: [F('name', 'Кто звонит', 'Мама ❤️'), F('sub', 'Подпись', 'мобильный'), F('emoji', 'Аватар', '👩', 'emoji'), F('img', 'Фото (вместо эмодзи)', '', 'image'),
      F('accept', 'Ответить в конце', true, 'bool'), STRIP],
    make: (f, c) => ({ widget: { type: 'callfull', name: f.name, sub: f.sub, avatar: AV(f, '👩', 'linear-gradient(180deg,#FFB1C8,#FF5C8A)'), accept_at: f.accept ? c.word(Math.max(0, c.n - 1)) : undefined, scale: 0.92,
      lyric: strip(f, 'status', { icon: '📞' }) } }) });

  add({ id: 'server', name: 'Сервер-чат (тёмный, каналы)', cat: 'Переписка', lines: 1,
    fields: [F('channel', 'Канал', 'общий'), F('me', 'Мой ник', 'melhor'), F('img', 'Моя аватарка', '', 'image'),
      F('n1', 'Друг 1', 'leartz'), F('m1', 'Сообщение 1', 'кто на созвон?'), F('n2', 'Друг 2', 'vissking'), F('m2', 'Сообщение 2', 'я тут, пишу трек'), F('react', 'Реакция на моё', '🔥', 'emoji')],
    make: (f, c) => ({ widget: { type: 'server', channel: f.channel, me: f.me, meAvatar: f.img ? { img: f.img } : undefined, text: c.all, at: c.word(0), react: f.react || undefined, react_at: c.word(Math.max(0, c.n - 1)), reactN: 23, height: 500, scale: 1.25,
      msgs: [[f.n1, f.m1, '#3BA55D'], [f.n2, f.m2, '#EB459E']].filter(x => x[1]).map(x => ({ name: x[0], text: x[1], color: x[2], time: 'Сегодня, в 04:1' + (x[2] === '#3BA55D' ? '8' : '9') })) } }) });

  // ---------- Соцсети ----------
  add({ id: 'vc-sheet', name: 'Комментарии под видео (шторка)', cat: 'Соцсети', lines: 1,
    fields: [F('me', 'Мой ник', 'melhor'), F('img', 'Моя аватарка', '', 'image'), F('likes', 'Лайков на моём', 1337, 'number'), F('count', 'Всего комментариев', 482, 'number'),
      F('u1', 'Ник 1', 'leartz'), F('c1', 'Комментарий 1', 'это шедевр 😭'), F('u2', 'Ник 2', 'vissking'), F('c2', 'Комментарий 2', 'кто в 2026?'), F('dark', 'Тёмная тема', false, 'bool')],
    make: (f, c) => ({ widget: { type: 'vcomments', style: 'sheet', dark: !!f.dark, me: f.me, meAvatar: f.img ? { img: f.img } : undefined, text: c.all, at: c.word(0), likes: +f.likes, count: +f.count, like_at: c.word(Math.max(0, c.n - 1)), scale: 1.25,
      items: [[f.u1, f.c1, 812], [f.u2, f.c2, 96]].filter(x => x[1]).map(x => ({ user: x[0], text: x[1], likes: x[2], time: '1 д' })) } }) });

  add({ id: 'vc-list', name: 'Комментарии с лайками (список)', cat: 'Соцсети', lines: 1,
    fields: [F('me', 'Мой ник', 'melhor'), F('img', 'Моя аватарка', '', 'image'), F('likes', 'Лайков на моём', 4200, 'number'), F('count', 'Всего комментариев', 1290, 'number'),
      F('u1', 'Ник 1', 'leartz'), F('c1', 'Комментарий 1', 'переслушал 100 раз'), F('u2', 'Ник 2', 'vissking'), F('c2', 'Комментарий 2', 'кто тоже из рекомендаций?'), F('dark', 'Тёмная тема', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'vcomments', style: 'list', dark: !!f.dark, me: f.me, meAvatar: f.img ? { img: f.img } : undefined, text: c.all, at: c.word(0), likes: +f.likes, count: +f.count, like_at: c.word(Math.max(0, c.n - 1)), mePos: 'top', scale: 1.25,
      items: [[f.u1, f.c1, 2100], [f.u2, f.c2, 340]].filter(x => x[1]).map(x => ({ user: x[0], text: x[1], likes: x[2], time: '3 дня назад' })) } }) });

  add({ id: 'post', name: 'Пост в ленте (с лайками)', cat: 'Соцсети', lines: 2,
    fields: [F('name', 'Имя', 'melhor'), F('handle', 'Ник', 'melhor'), F('img', 'Аватарка', '', 'image'), F('pic', 'Картинка в посте (необязательно)', '', 'image'),
      F('likes', 'Лайков', 13700, 'number'), F('views', 'Просмотров', 250000, 'number'), F('verified', 'Галочка', true, 'bool'), F('dark', 'Тёмная тема', false, 'bool')],
    make: (f, c) => ({ widget: { type: 'post', name: f.name, handle: f.handle, avatar: f.img ? { img: f.img } : { i: (f.name || '?')[0], color: 'linear-gradient(135deg,#7B61FF,#C04CFD)' }, img: f.pic || undefined, verified: !!f.verified, dark: !!f.dark,
      text: c.all, at: c.word(0), likes: +f.likes, views: +f.views, like_at: c.word(Math.max(0, c.n - 1)), scale: f.pic ? 1.12 : 1.25 } }) });

  add({ id: 'story', name: 'Сторис: текст-стикер по словам', cat: 'Соцсети', lines: 1,
    fields: [F('name', 'Имя', 'melhor'), F('img', 'Аватарка', '', 'image'), F('bgimg', 'Фон сторис (картинка)', '', 'image'), F('bg', 'Фон, если без картинки', '#DD2A7B', 'color'),
      F('box', 'Подложка текста', '#000000', 'color'), F('color', 'Цвет текста', '#FFFFFF', 'color'), F('like', 'Лайк в конце', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'story', name: f.name, avatar: f.img ? { img: f.img } : { i: (f.name || '?')[0], color: f.bg }, img: f.bgimg || undefined, bg: `linear-gradient(160deg,${f.bg} 0%,#8134AF 100%)`,
      box: f.box + 'D9', color: f.color, text: c.all, like_at: f.like ? c.word(Math.max(0, c.n - 1)) : undefined, scale: 0.92 } }) });

  // ---------- Музыка ----------
  add({ id: 'lyrics', name: 'Экран текста песни (караоке)', cat: 'Музыка', lines: 2,
    fields: [F('title', 'Трек', 'безумие'), F('artist', 'Артист', 'melhor'), F('bg', 'Цвет экрана', '#B03A3A', 'color'), F('emoji', 'Обложка', '🌿', 'emoji'), F('img', 'Обложка-картинка', '', 'image'),
      F('before', 'Строка перед (уже спета)', ''), F('after', 'Строка после (будет)', '')],
    make: (f, c) => ({ widget: { type: 'lyrics', title: f.title, artist: f.artist, bg: f.bg, emoji: f.emoji, img: f.img || undefined, before: [f.before], after: [f.after], scale: 1.25 } }) });

  add({ id: 'viz', name: 'Визуализатор звука + строка', cat: 'Музыка', lines: 1, nocard: true,
    fields: [F('mode', 'Вид', 'circle', 'select', ['circle', 'bars', 'wave']), F('color', 'Цвет', '#9B6BFF', 'color'), F('emoji', 'В центре круга', '🎧', 'emoji'), F('img', 'Обложка в центре', '', 'image'), F('line', 'Показывать строку', true, 'bool')],
    make: (f, c) => ({ widget: { type: 'viz', mode: f.mode, color: f.color, emoji: f.emoji, img: f.img || undefined, line: !!f.line, text: c.all, scale: 1 } }) });

  // ---------- Игры ----------
  add({ id: 'pcach', name: 'Ачивка на ПК (всплывашка)', cat: 'Игры', lines: 1,
    fields: [F('label', 'Надпись', 'Достижение разблокировано!'), F('desc', 'Описание', 'Редкое: есть у 0,4% игроков'), F('emoji', 'Значок', '🏆', 'emoji'), F('img', 'Значок-картинка', '', 'image'),
      F('got', 'Получено', 13, 'number'), F('total', 'Всего (0 — без полоски)', 50, 'number')],
    make: (f, c) => ({ widget: { type: 'pcach', label: f.label, desc: f.desc, emoji: f.emoji, img: f.img || undefined, text: c.all, at: c.word(0), got: +f.got, total: +f.total || undefined, scale: 1.25 } }) });

  // ---------- Типографика (без карточки) ----------
  const FONT = F('font', 'Шрифт', 'Inter Display', 'font');
  const KIN = (mode, extra) => (f, c) => ({ kinetic: Object.assign({ mode, font: f.font, color: f.color === '#000001' ? undefined : f.color, accent: f.accent, words: f.words, rot: f.rot === '' || f.rot == null ? undefined : +f.rot, size: +f.size || undefined }, extra || {}) });
  const KF = (rot) => [FONT, F('color', 'Цвет слов (чёрный = авто)', '#000001', 'color'), F('accent', 'Цвет выделения', '#E10600', 'color'), F('words', 'Выделить слова (через пробел)', ''),
    F('size', 'Размер, px (0 — авто)', 0, 'number'), F('rot', 'Наклон, °', rot, 'number')];
  add({ id: 'kin-stack', name: 'Крупные слова стопкой', cat: 'Типографика', lines: 1, nocard: true, fields: KF(6), make: KIN('stack') });
  add({ id: 'kin-punch', name: 'По одному слову на весь экран', cat: 'Типографика', lines: 1, nocard: true, fields: KF(14), make: KIN('punch') });
  add({ id: 'kin-pop', name: 'Слова выпрыгивают, выделение плашкой', cat: 'Типографика', lines: 2, nocard: true, fields: KF(0), make: KIN('pop') });

  window.TEMPLATES = T;
  window.TEMPLATE_CATS = [...new Set(T.map(t => t.cat))];
})();
