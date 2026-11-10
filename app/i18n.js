// Английский интерфейс: перевод текста в окне на лету.
// Строки ищутся целиком; «{}» — любое значение (оно тоже переводится, если это русское слово).
// Строка, которая кончается двоеточием, работает и как начало сообщения: «Ошибка: …».
(function () {
  let lang = 'ru'; try { lang = localStorage.getItem('ls-lang') || 'ru'; } catch (e) {}
  window.LANG = lang === 'en' ? 'en' : 'ru';
  const RAW = `
Отменить (Ctrl+Z) ⇒ Undo (Ctrl+Z)
Повторить (Ctrl+Y) ⇒ Redo (Ctrl+Y)
Ник, аватарка, логотип и цвет — подставляются во все шаблоны ⇒ Nickname, avatar, logo and colour — used in every template
Помощь ⇒ Help
с начала ⇒ from start
до конца ⇒ to end
Пробел ⇒ Space
На паузе карточки и стикеры в превью можно двигать мышкой ⇒ While paused, drag cards and stickers in the preview with the mouse
Упрощает дым, частицы и размытия в превью — для слабых компьютеров. На экспорт не влияет ⇒ Simplifies smoke, particles and blur in the preview — for slower computers. Does not affect export
Безопасные зоны площадки ⇒ Platform safe zones
Слова прилипают к битам при перетаскивании (Alt — временно выключить) ⇒ Words snap to beats while dragging (hold Alt to disable)
Объединить с предыдущей ⇒ Merge with previous
Разделить на месте курсора (S) ⇒ Split at cursor (S)
Объединить со следующей (M) ⇒ Merge with next (M)
Сохранить сцену как свой шаблон ⇒ Save scene as my template
название шаблона ⇒ template name
Понятно ✓ ⇒ Got it ✓
Подпрыгивание на сильной доле и эмодзи по смыслу — во всех сценах, где акценты не заданы ⇒ Bounce on the downbeat and matching emoji — in every scene without its own accents
По тексту ⇒ Fit to lyrics
когда проснулся и понял… ⇒ when I woke up and realised…
секунд ⇒ seconds
название ⇒ title
прозрачность ⇒ opacity
название трека ⇒ track title
надпись сверху: сейчас играет ⇒ label on top: now playing
слушай везде ⇒ listen everywhere
кнопка: ссылка в профиле ⇒ button: link in bio
Загрузить .ttf / .otf / .woff ⇒ Load .ttf / .otf / .woff
WebM 512 px, прозрачный, до 3 секунд от курсора ⇒ WebM 512 px, transparent, up to 3 seconds from the cursor
Профиль ⇒ Profile
Новый ▾ ⇒ New ▾
Пустой проект ⇒ Blank project
Новый в стиле текущего ⇒ New in current style
Пакет треков… ⇒ Batch of tracks…
Открыть ▾ ⇒ Open ▾
Сохранить ▾ ⇒ Save ▾
Сохранить ⇒ Save
Сохранить как… ⇒ Save as…
Сохранить вместе с треком (.lspz)… ⇒ Save with track (.lspz)…
Горячие клавиши ⇒ Keyboard shortcuts
Проверить обновления ⇒ Check for updates
Проверка системы… ⇒ System check…
Скопировать отчёт об ошибке ⇒ Copy error report
Открыть папку с журналом ⇒ Open log folder
Экспорт видео ⇒ Export video
Трек и текст ⇒ Track & lyrics
Слова ⇒ Words
Трек ⇒ Track
Выбрать файл… ⇒ Choose file…
не выбран ⇒ not selected
Текст песни ⇒ Lyrics
— одна строка = одна строка на экране ⇒ — one line = one line on screen
Подсказка: латиницу и цифры можно подсказать в фигурных скобках — ⇒ Tip: for Russian lyrics, spell Latin words and numbers in curly braces —
. Скобки на экран не попадут. ⇒ . The braces will not appear on screen.
Где искать текст в треке (сек) ⇒ Where the lyrics are in the track (sec)
русский ⇒ Russian
сначала отделить вокал ⇒ separate vocals first
Нейросеть уберёт бит перед синхронизацией — точнее на громком минусе, но дольше: примерно минута на минуту трека. Укажите отрезок выше, чтобы не обрабатывать весь трек. ⇒ The neural net removes the beat before syncing — more accurate on a loud instrumental but slower: about a minute per minute of track. Set a range above to avoid processing the whole track.
Синхронизировать слова ⇒ Sync words
Строк в сцене (для авторазбивки) ⇒ Lines per scene (auto split)
подбирать шаблоны по словам строки ⇒ pick templates by the words of the line
добавлять сцены-типографику ⇒ add typography scenes
Разбить на сцены заново ⇒ Re-split into scenes
Клик по слову — перейти к нему. Сдвигайте время кнопками ± или перетаскивайте слова на таймлайне под превью. ⇒ Click a word to jump to it. Shift timing with ± or drag words on the timeline below the preview.
✥ тащите в превью ⇒ ✥ drag in preview
лёгкое превью ⇒ light preview
зоны: нет ⇒ zones: off
зоны Reels ⇒ Reels zones
зоны TikTok ⇒ TikTok zones
зоны Shorts ⇒ Shorts zones
Таймлайн ⇒ Timeline
магнит к битам ⇒ snap to beats
Ctrl+колесо — масштаб · Shift+перетаскивание — сдвинуть строку ⇒ Ctrl+wheel — zoom · Shift+drag — move the whole line
весь ролик ⇒ whole video
Сцена ⇒ Scene
Стиль ⇒ Style
Эффекты ⇒ Effects
Добавьте трек и текст, затем нажмите «Синхронизировать слова» — сцены создадутся сами. ⇒ Add a track and lyrics, then press “Sync words” — scenes are created automatically.
⇤ объединить ⇒ ⇤ merge
разделить ⇒ split
объединить ⇥ ⇒ merge ⇥
копировать вид ⇒ copy look
вставить вид ⇒ paste look
в мои шаблоны ⇒ to my templates
Шаблон ⇒ Template
сменить… ⇒ change…
Вторая карточка в этой сцене ⇒ Second card in this scene
добавить… ⇒ add…
убрать ⇒ remove
Первая карточка показывает первую половину строк сцены, вторая — вторую. Карточки можно двигать мышкой прямо в превью. ⇒ The first card shows the first half of the scene's lines, the second card the rest. Drag the cards right in the preview.
Акценты ⇒ Accents
Подпрыгнуть на слове ⇒ Bounce on word
Штамп (текст, пусто — без штампа) ⇒ Stamp (text, empty — none)
Частицы-эмодзи (пусто — без) ⇒ Emoji particles (empty — none)
Переход сцены ⇒ Scene transition
как в стиле ⇒ as in style
плавно ⇒ fade
всплытие ⇒ pop up
слайд ⇒ slide
резкий ⇒ snap
зум ⇒ zoom
хлыст ⇒ whip
падение ⇒ drop
Камера ⇒ Camera
нет ⇒ none
наезд ⇒ push in
отъезд ⇒ pull out
панорама ← ⇒ pan ←
панорама → ⇒ pan →
покачивание ⇒ sway
Размер карточки ⇒ Card size
Стикеры и надписи ⇒ Stickers & captions
Появляются в момент, где стоит курсор, на 2,5 с. Двигайте их мышкой в превью, колесо мыши — размер. ⇒ They appear at the cursor for 2.5 s. Drag them in the preview, mouse wheel — size.
+ эмодзи ⇒ + emoji
+ надпись ⇒ + caption
+ картинка ⇒ + image
авто-акценты для всех сцен ⇒ auto accents for all scenes
убрать авто-акценты ⇒ remove auto accents
Двойной клик по слову на таймлайне — свой акцент для этого слова: цвет, увеличение, тряска, эмодзи. ⇒ Double-click a word on the timeline to give it its own accent: colour, zoom, shake, emoji.
Пресет ⇒ Preset
— наведите на свой, чтобы удалить ⇒ — hover over yours to delete it
Импорт из файла… ⇒ Import from file…
Сохранить в файл… ⇒ Save to file…
Формат ⇒ Format
Отрезок ролика (сек) ⇒ Video range (sec)
по тексту ⇒ fit to lyrics
лучший кусок: ⇒ best part:
15 с ⇒ 15 s
30 с ⇒ 30 s
60 с ⇒ 60 s
Обрезка и затухание звука ⇒ Trimming & audio fades
обрезать автоматически после синхронизации ⇒ trim automatically after syncing
Начало — на сильной доле за такт до первой строки, конец — на сильной доле после последней. Резы попадают в такт, поэтому склейки не слышно. ⇒ Starts on the downbeat one bar before the first line and ends on the downbeat after the last. Cuts land on the beat, so the joins are inaudible.
Обрезать сейчас по тактам ⇒ Trim to bars now
вырезать проигрыши без текста длиннее ⇒ cut instrumental gaps longer than
с ⇒ s
Нарастание в начале, с ⇒ Fade in, s
Затухание в конце, с ⇒ Fade out, s
Кривая затухания ⇒ Fade curve
плавная ⇒ smooth
линейная ⇒ linear
мягкая — тише к самому концу ⇒ soft — quieter towards the very end
быстрая — сразу заметно тише ⇒ fast — noticeably quieter right away
затемнять видео вместе со звуком ⇒ fade the picture together with the sound
менять сцены точно на сильную долю такта ⇒ change scenes exactly on the downbeat
Текст-крючок сверху (первые секунды, пусто — без) ⇒ Hook text on top (first seconds, empty — none)
Артист (плашка «сейчас играет»; пусто — без плашки) ⇒ Artist (“now playing” badge; empty — none)
Вотермарка: текст и/или логотип ⇒ Watermark: text and/or logo
Фон: своё фото или видео ⇒ Background: your photo or video
Размытие ⇒ Blur
Затемнение ⇒ Dim
медленный наезд камеры (для фото) ⇒ slow camera push-in (for photos)
Интро и аутро ⇒ Intro & outro
интро: название трека крупно перед первой строкой ⇒ intro: big track title before the first line
аутро: призыв в конце ⇒ outro: call to action at the end
Интро и аутро добавляют секунды трека до первой и после последней строки. ⇒ Intro and outro add track seconds before the first and after the last line.
Адлибы — слова в скобках, например (эй) ⇒ Ad-libs — words in brackets, e.g. (hey)
плашками у карточки ⇒ as chips next to the card
оставить в строке ⇒ keep in the line
не показывать ⇒ hide
Конструктор стиля ⇒ Style builder
свой стиль поверх пресета ⇒ my own style over the preset
Цвета с обложки трека… ⇒ Colours from track cover…
Основа ⇒ Base
светлые карточки ⇒ light cards
тёмная ⇒ dark
мягкая, текст под карточкой ⇒ soft, text under the card
небо, объёмный текст ⇒ sky, 3D text
всё в телефоне ⇒ everything in a phone
постер, крупные слова ⇒ poster, big words
Фон ⇒ Background
градиент ⇒ gradient
сплошной ⇒ solid
пятно в центре ⇒ centre glow
клетка ⇒ gingham
тетрадь ⇒ notebook
Шрифт подписей и типографики ⇒ Font for captions and typography
свой… ⇒ custom…
Цвет акцента ⇒ Accent colour
выделения в типографике, плашки ⇒ typography highlights, badges
Наклон карточек ⇒ Card tilt
Переход между сценами ⇒ Transition between scenes
из пресета ⇒ from preset
плавное появление ⇒ fade in
всплытие из угла ⇒ pop from corner
слайд сбоку ⇒ slide from side
резкий снизу ⇒ snap from below
пролёт сквозь (зум) ⇒ fly-through (zoom)
хлыст (смаз) ⇒ whip (blur)
падение с отскоком ⇒ drop with bounce
Тонкая настройка ⇒ Fine tuning
Частицы на фоне ⇒ Background particles
звёзды ⇒ stars
снег ⇒ snow
дождь ⇒ rain
огни ⇒ lights
искры ⇒ sparks
Пульс фона под бит ⇒ Background pulse on beat
Цвет дыма ⇒ Smoke colour
свой цвет ⇒ custom colour
Опережение сцены (сек) ⇒ Scene lead (sec)
Сохранить текущий стиль как свой пресет ⇒ Save current style as my preset
Эффекты ложатся поверх любого пресета и сохраняются в своём пресете. ⇒ Effects go over any preset and are saved in your own preset.
Зерно плёнки ⇒ Film grain
VHS: полосы, рябь, PLAY и дата ⇒ VHS: lines, noise, PLAY and date
Хроматическая аберрация ⇒ Chromatic aberration
Тряска камеры на бит ⇒ Camera shake on beat
Тряска и аберрация реагируют на биты трека. Если битов не видно на таймлайне, они берутся из громкости баса. ⇒ Shake and aberration react to the track's beats. If no beats show on the timeline, bass loudness is used.
3D-наклон карточек (в «телефоне» — блик на экране) ⇒ 3D card tilt (in “phone” — screen glare)
сильнее на припеве и дропе, тише в спокойных местах ⇒ stronger on the chorus and drop, calmer in quiet parts
Сбросить эффекты ⇒ Reset effects
Звуковые эффекты ⇒ Sound effects
подмешивать звуки к треку ⇒ mix sounds into the track
Громкость ⇒ Volume
вжух на переходах ⇒ whoosh on transitions
события виджетов: «дзынь», клики, звонок ⇒ widget events: dings, clicks, ringing
удары на штампах и акцентах ⇒ hits on stamps and accents
Звуки слышны в превью и сводятся с треком при экспорте (кроме GIF). ⇒ Sounds play in the preview and are mixed with the track on export (except GIF).
Шаблоны сцен ⇒ Scene templates
Куда ⇒ Where
Свой ⇒ Custom
Файл ⇒ File
MOV · прозрачный фон ⇒ MOV · transparent
WebM · прозрачный ⇒ WebM · transparent
стикер TG ⇒ TG sticker
Фон, дым и частицы не попадут в видео — останутся карточки, текст и эмодзи. MOV (ProRes 4444) открывают Premiere, DaVinci, Final Cut и CapCut на компьютере; файл большой. ⇒ Background, smoke and particles are left out — only cards, text and emoji remain. MOV (ProRes 4444) opens in Premiere, DaVinci, Final Cut and desktop CapCut; the file is large.
Качество ⇒ Quality
Кадров в секунду ⇒ Frames per second
60 · плавнее, вдвое дольше ⇒ 60 · smoother, twice as slow
кодировать видеокартой, если есть ⇒ encode on the graphics card if available
черновик: 360p, 15 кадров/с — быстро проверить ролик ⇒ draft: 360p, 15 fps — quick check
Сохранить видео… ⇒ Save video…
Отмена ⇒ Cancel
Показать в папке ⇒ Show in folder
Очередь: несколько версий за раз ⇒ Queue: several versions at once
+ текущие настройки ⇒ + current settings
+ 9:16, 1:1 и 16:9 ⇒ + 9:16, 1:1 and 16:9
Сохранить всю очередь в папку… ⇒ Save the whole queue to a folder…
Картинки: кадр и обложка ⇒ Images: frame & cover
Текущий кадр в PNG ⇒ Current frame as PNG
Обложка: 3 варианта… ⇒ Cover: 3 variants…
Обложка — название трека крупно и ник артиста в текущем стиле, размер по формату ролика. ⇒ Cover — big track title and artist name in the current style, sized to the video format.
играть / пауза ⇒ play / pause
перемотка на 1 с (с Shift — на 5 с) ⇒ seek 1 s (with Shift — 5 s)
предыдущая / следующая сцена ⇒ previous / next scene
в начало ролика ⇒ go to start
разрезать сцену на месте курсора ⇒ split scene at cursor
объединить сцену со следующей ⇒ merge scene with next
сменить шаблон сцены ⇒ change scene template
+клик, ⇒ +click,
+клик ⇒ +click
выделить несколько сцен ⇒ select several scenes
скопировать вид сцены / вставить на выделенные ⇒ copy scene look / paste to selected
отменить ⇒ undo
повторить ⇒ redo
сохранить (с Shift — сохранить как) ⇒ save (with Shift — save as)
открыть проект ⇒ open project
экспорт видео ⇒ export video
+колесо ⇒ +wheel
масштаб таймлайна ⇒ timeline zoom
Профиль артиста ⇒ Artist profile
Подставляется во все шаблоны вместо «melhor»: ник в чатах, постах, комментариях и плеере, аватарка там, где «я», логотип — в вотермарку новых проектов. ⇒ Used in every template instead of “melhor”: nickname in chats, posts, comments and the player, avatar wherever it's “me”, logo in the watermark of new projects.
Ник ⇒ Nickname
Аватарка ⇒ Avatar
Логотип для вотермарки ⇒ Watermark logo
Фирменный цвет ⇒ Brand colour
Применить к текущему проекту ⇒ Apply to current project
Сохранить профиль ⇒ Save profile
Проверка системы ⇒ System check
Проверяет, всё ли нужное для работы есть на этом компьютере, и делает пробный экспорт 3 секунд со звуковыми эффектами. Ничего не сохраняется. ⇒ Checks that this computer has everything needed and makes a 3-second test export with sound effects. Nothing is saved.
Проверить снова ⇒ Check again
Скопировать результат ⇒ Copy results
Папка с журналом ⇒ Log folder
Обложка — выберите вариант ⇒ Cover — pick a variant
Название ⇒ Title
Артист ⇒ Artist
обновить ⇒ refresh
Пакетная обработка треков ⇒ Batch processing
Каждый трек: синхронизация → умная обрезка → сцены (с подбором по словам) → авто-акценты → экспорт в текущем стиле, эффектах и звуках. Рядом с видео сохраняется проект .lsp, его можно открыть и поправить. ⇒ Each track: sync → smart trim → scenes (matched to the words) → auto accents → export in the current style, effects and sounds. A .lsp project is saved next to each video so you can open and tweak it.
+ треки… ⇒ + tracks…
Форматы: ⇒ Formats:
авто-акценты ⇒ auto accents
Выбрать папку и запустить ⇒ Choose folder and start
Остановить после текущего ⇒ Stop after current
цвет ⇒ colour
увеличение ⇒ zoom
тряска камеры ⇒ camera shake
эмодзи ⇒ emoji
сбросить ⇒ reset
готово ⇒ done
iMessage: я пишу ⇒ iMessage: I'm texting
Переписка ⇒ Messaging
Telegram: пишет она ⇒ Telegram: she's texting
Telegram: групповой чат ⇒ Telegram: group chat
Telegram: прокрутка по дням ⇒ Telegram: scrolling through days
Экран блокировки + уведомления ⇒ Lock screen + notifications
Входящий звонок ⇒ Incoming call
Тёмная карточка: печатает строку ⇒ Dark card: typing the line
Справка / документ с печатью ⇒ Certificate / stamped document
Документы ⇒ Documents
Медкарта / анкета ⇒ Medical record / form
Список / рацион с метками ⇒ List / menu with tags
Список дел с галочками ⇒ To-do list with checkmarks
Бомба: таймер и дефуз ⇒ Bomb: timer and defuse
Игры ⇒ Games
Счёт матча + «раунд проигран» ⇒ Match score + “round lost”
Крит-урон по мне ⇒ Critical hit on me
Достижение получено ⇒ Achievement unlocked
Приглашение / покупка: отклонить ⇒ Invite / purchase: decline
Счётчик + график ⇒ Counter + chart
Цифры ⇒ Numbers
Батарея садится ⇒ Battery running low
Опрос с процентами ⇒ Poll with percentages
Ползунок «уровень» ⇒ “Level” slider
Пульс с ЭКГ ⇒ Heart rate with ECG
Рейтинг со звёздами ⇒ Star rating
Банковская карта ⇒ Bank card
Доставка / корзина ⇒ Delivery / cart
Тумблеры: каждая строка — переключатель ⇒ Toggles: each line is a switch
Состояние ⇒ Status
День / Ночь переключатель ⇒ Day / Night switch
Погода: строка = место и прогноз ⇒ Weather: line = place and forecast
Дождь из лина ⇒ Lean rain
Диктофон: идёт запись ⇒ Voice memo: recording
Плеер: строка = название трека ⇒ Player: line = track title
Музыка ⇒ Music
Дорога: машина едет мимо ⇒ Road: a car drives by
Дорога ⇒ Road
Карта: маршрут с поворотами ⇒ Map: route with turns
iMessage: диалог (она → я) ⇒ iMessage: dialogue (her → me)
Звонок на весь экран ⇒ Full-screen call
Сервер-чат (тёмный, каналы) ⇒ Server chat (dark, channels)
Комментарии под видео (шторка) ⇒ Video comments (sheet)
Соцсети ⇒ Social
Комментарии с лайками (список) ⇒ Comments with likes (list)
Пост в ленте (с лайками) ⇒ Feed post (with likes)
Сторис: текст-стикер по словам ⇒ Story: word-by-word text sticker
Экран текста песни (караоке) ⇒ Lyrics screen (karaoke)
Визуализатор звука + строка ⇒ Audio visualiser + line
Свой виджет из блоков (конструктор) ⇒ Custom widget from blocks (builder)
Конструктор ⇒ Builder
Ачивка на ПК (всплывашка) ⇒ PC achievement (pop-up)
Крупные слова стопкой ⇒ Big stacked words
Типографика ⇒ Typography
По одному слову на весь экран ⇒ One word per full screen
Слова выпрыгивают, выделение плашкой ⇒ Words pop out, highlighted with a badge
Текст строки ⇒ Line text
Контакт ⇒ Contact
Аватар ⇒ Avatar
Цвет аватара ⇒ Avatar colour
Фото (вместо эмодзи) ⇒ Photo (instead of emoji)
Ответ в конце (пусто — без ответа) ⇒ Reply at the end (empty — none)
Клавиатура ⇒ Keyboard
Статус ⇒ Status
Время ⇒ Time
Название чата ⇒ Chat name
Друг 1 ⇒ Friend 1
Сообщение 1 ⇒ Message 1
Друг 2 ⇒ Friend 2
Сообщение 2 ⇒ Message 2
Друг 3 ⇒ Friend 3
Сообщение 3 ⇒ Message 3
Фото чата ⇒ Chat photo
Сообщения по кругу (через |) ⇒ Rotating messages (separated by |)
Реакция ⇒ Reaction
Дата ⇒ Date
Приложение 1 ⇒ App 1
Значок 1 ⇒ Icon 1
Приложение 2 ⇒ App 2
Значок 2 ⇒ Icon 2
Заголовок 2 ⇒ Title 2
Кто звонит ⇒ Caller
Подпись ⇒ Caption
Подпись после ответа ⇒ Caption after answering
Эмодзи в конце ⇒ Emoji at the end
Организация ⇒ Organisation
Заголовок ⇒ Heading
Пациент ⇒ Patient
Поле для 1-й строки ⇒ Field for line 1
Поле для 2-й строки ⇒ Field for line 2
Выделенное поле: название ⇒ Highlighted field: name
Выделенное поле: текст ⇒ Highlighted field: text
Второе выделение: название ⇒ Second highlight: name
Второе выделение: текст ⇒ Second highlight: text
Текст печати ⇒ Stamp text
Цвет печати ⇒ Stamp colour
Имя ⇒ Name
Строка 1: поле ⇒ Row 1: field
Строка 1: значение ⇒ Row 1: value
Строка 2: поле ⇒ Row 2: field
Строка 2: значение ⇒ Row 2: value
Подзаголовок ⇒ Subtitle
Справа ⇒ Right
Метка 1 ⇒ Tag 1
Метка 2 ⇒ Tag 2
Значок 3 ⇒ Icon 3
Метка 3 ⇒ Tag 3
Пункт 1 ⇒ Item 1
Пункт 2 ⇒ Item 2
Штамп в конце (пусто — без) ⇒ Stamp at the end (empty — none)
Надпись ⇒ Label
Значок дефуза ⇒ Defuse icon
Таймер с (сек) ⇒ Timer from (sec)
Вторая команда ⇒ Second team
Значок 1-й команды ⇒ Team 1 icon
Значок 2-й команды ⇒ Team 2 icon
Счёт 1-й ⇒ Team 1 score
Счёт 2-й ⇒ Team 2 score
Баннер ⇒ Banner
Счётчик: подпись ⇒ Counter: label
Счётчик до ⇒ Counter to
Единица ⇒ Unit
Действие (полоска) ⇒ Action (bar)
Игрок ⇒ Player
Урон ⇒ Damage
Что ⇒ What
Нажать ⇒ Press
Приложение ⇒ App
Значок ⇒ Icon
Число ⇒ Number
График ⇒ Chart
Заряд с % ⇒ Charge from %
Кнопка ⇒ Button
Вопрос ⇒ Question
Вариант 1 ⇒ Option 1
Вариант 2 ⇒ Option 2
До (0–1) ⇒ To (0–1)
Слева ⇒ Left
Пульс с ⇒ Pulse from
Пульс до ⇒ Pulse to
Кого оценивают ⇒ Who is rated
Оценка ⇒ Rating
Имя на карте ⇒ Name on card
Надпись на карте ⇒ Card label
Выделить слово ⇒ Highlight word
Номер ⇒ Number
Подпись 1 ⇒ Label 1
Цена 1 ⇒ Price 1
Подпись 2 ⇒ Label 2
Цена 2 ⇒ Price 2
Тумблер снизу ⇒ Toggle at the bottom
Значок тумблера ⇒ Toggle icon
Температура ⇒ Temperature
Погода ⇒ Weather
Место ⇒ Place
Название записи ⇒ Recording name
Обложка ⇒ Cover
Обложка-картинка ⇒ Cover image
Метки по пути (через пробел) ⇒ Markers along the way (space-separated)
Машина ⇒ Car
Справа снизу ⇒ Bottom right
Извилистый путь ⇒ Winding route
Подпись под моим ⇒ Caption under mine
Ответить в конце ⇒ Reply at the end
Канал ⇒ Channel
Мой ник ⇒ My nickname
Моя аватарка ⇒ My avatar
Реакция на моё ⇒ Reaction to mine
Лайков на моём ⇒ Likes on mine
Всего комментариев ⇒ Total comments
Ник 1 ⇒ Nickname 1
Комментарий 1 ⇒ Comment 1
Ник 2 ⇒ Nickname 2
Комментарий 2 ⇒ Comment 2
Тёмная тема ⇒ Dark theme
Картинка в посте (необязательно) ⇒ Post image (optional)
Лайков ⇒ Likes
Просмотров ⇒ Views
Галочка ⇒ Verified tick
Фон сторис (картинка) ⇒ Story background (image)
Фон, если без картинки ⇒ Background without image
Подложка текста ⇒ Text backing
Цвет текста ⇒ Text colour
Лайк в конце ⇒ Like at the end
Цвет экрана ⇒ Screen colour
Строка перед (уже спета) ⇒ Line before (already sung)
Строка после (будет) ⇒ Line after (coming up)
Вид ⇒ Style
Цвет ⇒ Colour
В центре круга ⇒ In the centre of the circle
Обложка в центре ⇒ Cover in the centre
Показывать строку ⇒ Show the line
Блоки ⇒ Blocks
Тёмная карточка ⇒ Dark card
Фон карточки ⇒ Card background
Акцент (кнопки, пузыри) ⇒ Accent (buttons, bubbles)
Ширина, px ⇒ Width, px
Описание ⇒ Description
Значок-картинка ⇒ Icon image
Получено ⇒ Progress
Всего (0 — без полоски) ⇒ Total (0 — no bar)
Шрифт ⇒ Font
Цвет слов (чёрный = авто) ⇒ Word colour (black = auto)
Цвет выделения ⇒ Highlight colour
Выделить слова (через пробел) ⇒ Highlight words (space-separated)
Размер, px (0 — авто) ⇒ Size, px (0 — auto)
Наклон, ° ⇒ Tilt, °
дымка, листики, окна плавают ⇒ haze, leaves, floating windows
лента сверху вниз ⇒ top-to-bottom feed
тёмный дым, звёзды ⇒ dark smoke, stars
неон, ночь ⇒ neon, night
монтажка REC ⇒ REC camcorder
огромные слова ⇒ huge words
небо и облака ⇒ sky and clouds
мягкий поп ⇒ soft pop
всё в iPhone ⇒ everything in an iPhone
розовая клетка ⇒ pink gingham
дождь, грусть ⇒ rain, sadness
ссылка в профиле ⇒ link in bio
Скопировать отчёт ⇒ Copy report
есть ⇒ yes
Отчёт скопирован — вставьте его в сообщение (Ctrl+V) ⇒ Report copied — paste it into a message (Ctrl+V)
Не удалось скопировать отчёт ⇒ Could not copy the report
Загрузить свой… ⇒ Load your own…
≈ {} BPM · {} битов ⇒ ≈ {} BPM · {} beats
Нужны трек и синхронизированные слова ⇒ Needs a track and synced words
Трек короче выбранной длины ⇒ The track is shorter than the chosen length
Выбран кусок {}–{} ({} с) ⇒ Selected part {}–{} ({} s)
Сначала синхронизируйте слова ⇒ Sync the words first
Расставлено акцентов: {} ⇒ Accents placed: {}
Все сцены уже с акцентами ⇒ All scenes already have accents
Авто-акценты убраны ⇒ Auto accents removed
Нет текста ⇒ No lyrics
Ошибка движка: ⇒ Engine error:
Сначала выберите трек ⇒ Choose a track first
подпись и ник {} ⇒ caption and nickname {}
кнопки ⇒ buttons
Трек загружен ⇒ Track loaded
Не удалось прочитать файл: ⇒ Could not read the file:
Вставьте текст песни ⇒ Paste the lyrics
Готовлюсь… ⇒ Getting ready…
Готово: {} слов, {} сцен. ⇒ Done: {} words, {} scenes.
Вокал плохо слышно — проверьте тайминги на таймлайне. ⇒ The vocals are hard to hear — check the timing on the timeline.
Ошибка: ⇒ Error:
Ролик {}–{}, вырезано проигрышей: {} ⇒ Video {}–{}, instrumental gaps cut: {}
Ролик {}–{} ⇒ Video {}–{}
✂ {} → {} · {} с ⇒ ✂ {} → {} · {} s
Пересобрать сцены? Текущие настройки сцен пропадут (можно вернуть через Ctrl+Z). ⇒ Rebuild scenes? Current scene settings will be lost (Ctrl+Z brings them back).
круг вокруг обложки ⇒ circle around the cover
полосы ⇒ bars
волна ⇒ wave
как в шаблоне ⇒ as in template
заметка ⇒ note
фиолетовая лента ⇒ purple ticker
расшифровка (тёмная) ⇒ transcript (dark)
статус (зелёный) ⇒ status (green)
предупреждение ⇒ warning
поиск сверху ⇒ search on top
данные ⇒ data
отклонить ⇒ decline
одобрить ⇒ approve
Выбрать картинку… ⇒ Choose image…
заменить ⇒ replace
Сцена {} из {} · {} ⇒ Scene {} of {} · {}
Выделено сцен: ⇒ Scenes selected:
. Шаблон из галереи и «вставить вид» применятся ко всем выделенным. ⇒ . A gallery template and “paste look” will apply to all selected.
Эта строка повторяется в сценах ⇒ This line repeats in scenes
(припев). ⇒ (chorus).
менять повторы вместе с этой сценой ⇒ change the repeats together with this scene
авто ⇒ auto
Шапка ⇒ Header
Аватар-эмодзи ⇒ Avatar emoji
Аватар-картинка ⇒ Avatar image
Справа (время) ⇒ Right (time)
Текст ⇒ Text
Размер ⇒ Size
Выравнивание ⇒ Alignment
слева ⇒ left
по центру ⇒ centre
справа ⇒ right
Пузырь сообщения ⇒ Message bubble
Сторона ⇒ Side
справа (я) ⇒ right (me)
слева (собеседник) ⇒ left (them)
Картинка ⇒ Image
Или эмодзи ⇒ Or emoji
Высота ⇒ Height
Счётчик ⇒ Counter
От ⇒ From
До ⇒ To
Перед числом ⇒ Before the number
После числа ⇒ After the number
Полоса прогресса ⇒ Progress bar
Процент ⇒ Percent
Ширина ⇒ Width
во всю ширину ⇒ full width
Ряд эмодзи ⇒ Emoji row
Эмодзи через пробел ⇒ Emoji, space-separated
Разделитель ⇒ Divider
строка сцены ⇒ scene line
первая половина строк ⇒ first half of the lines
вторая половина строк ⇒ second half of the lines
свой текст ⇒ custom text
+ добавить блок… ⇒ + add block…
текст ⇒ text
Выбрать… ⇒ Choose…
просмотры ⇒ views
загрузка ⇒ loading
Ответить ⇒ Reply
Слишком короткая сцена ⇒ The scene is too short
Курсор после последнего слова сцены ⇒ The cursor is after the scene's last word
Вид сцены скопирован — выделите сцены и нажмите Ctrl+V ⇒ Scene look copied — select scenes and press Ctrl+V
Сначала скопируйте вид сцены (Ctrl+C) ⇒ Copy a scene look first (Ctrl+C)
Вставлено в {} сцен ⇒ Pasted into {} scenes
Вставлено ⇒ Pasted
Все ⇒ All
Мои ⇒ Mine
Шаблон второй карточки ⇒ Second card template
1 строка ⇒ 1 line
{} строки ⇒ {} lines
{} строки · без карточки ⇒ {} lines · no card
1 строка · без карточки ⇒ 1 line · no card
мой · {} ⇒ mine · {}
Удалить ⇒ Delete
Удалить шаблон «{}»? ⇒ Delete template “{}”?
Шаблон применён к {} сценам ⇒ Template applied to {} scenes
Впишите название шаблона ⇒ Enter a template name
Шаблон «{}» сохранён — он в галерее, раздел «Мои» ⇒ Template “{}” saved — find it in the gallery under “Mine”
мой пресет ⇒ my preset
Удалить пресет «{}»? ⇒ Delete preset “{}”?
Логотип-картинка… ⇒ Logo image…
выкл ⇒ off
видео ⇒ video
Фото или видео… ⇒ Photo or video…
Нужен загруженный трек ⇒ Load a track first
Цвета взяты с обложки: ⇒ Colours taken from the cover:
Шрифт «{}» добавлен ⇒ Font “{}” added
Впишите название пресета ⇒ Enter a preset name
Так называется встроенный пресет — выберите другое имя ⇒ A built-in preset has this name — choose another
Пресет сохранён ⇒ Preset saved
Пресет сохранён в файл ⇒ Preset saved to file
Файл «{}» не похож на пресет ⇒ File “{}” does not look like a preset
Пресет «{}» добавлен ⇒ Preset “{}” added
Добавлено пресетов: {} ⇒ Presets added: {}
Отменено ⇒ Undone
Повторено ⇒ Redone
новый проект ⇒ new project
Трек не найден по старому пути — выберите его заново ⇒ Track not found at its old location — choose it again
Сохранено ⇒ Saved
Текущий проект не сохранён. Открыть другой? ⇒ The current project is not saved. Open another one?
Файл проекта повреждён ⇒ The project file is damaged
Начать новый проект? Несохранённые изменения пропадут. ⇒ Start a new project? Unsaved changes will be lost.
Новый проект в том же стиле — выберите трек и вставьте текст ⇒ New project in the same style — choose a track and paste the lyrics
В проекте нет трека ⇒ The project has no track
Сохранено вместе с треком: ⇒ Saved with track:
Не удалось сохранить: ⇒ Could not save:
Открыть файл… ⇒ Open file…
Недавние ⇒ Recent
Выбрать аватарку… ⇒ Choose avatar…
Выбрать логотип… ⇒ Choose logo…
Профиль сохранён — ник и аватарка подставятся во все шаблоны ⇒ Profile saved — your nickname and avatar will be used in every template
Профиль применён к проекту ⇒ Profile applied to the project
Проверяю компоненты… ⇒ Checking components…
Проверка ⇒ Check
Компоненты ⇒ Components
проверяю… ⇒ checking…
Звук ⇒ Sound
синтезируются ⇒ synthesised
получилась тишина ⇒ came out silent
Воспроизведение ⇒ Playback
WebAudio работает ⇒ WebAudio works
Пробный экспорт ⇒ Test export
3 секунды, MP4 со звуком ⇒ 3 seconds, MP4 with sound
рендерю… ⇒ rendering…
файл получился неправильный: {} с ⇒ the file is wrong: {} s
файл получился неправильный: {} с, без звука ⇒ the file is wrong: {} s, no sound
готово за {} с · {} КБ · {} с со звуком ⇒ done in {} s · {} KB · {} s with sound
готово за {} с · {} КБ · {} с со звуком · видеокарта не справилась, сработал процессор ⇒ done in {} s · {} KB · {} s with sound · the graphics card failed, the CPU took over
готово за {} с · {} КБ · {} с со звуком · через {} ⇒ done in {} s · {} KB · {} s with sound · via {}
не получилось ⇒ failed
Кадр в PNG ⇒ Frame to PNG
сохраняется ⇒ works
пустой кадр ⇒ blank frame
Есть проблемы: {}. Скопируйте результат и пришлите его вместе с отчётом об ошибке. ⇒ Problems found: {}. Copy the results and send them along with an error report.
Всё работает. Замечаний: {} — на работу не влияют, но могут замедлять. ⇒ Everything works. Notes: {} — they don't break anything but may slow things down.
Всё в порядке. ⇒ All good.
Результат и журнал скопированы — вставьте в сообщение (Ctrl+V) ⇒ Results and log copied — paste them into a message (Ctrl+V)
Не удалось скопировать ⇒ Could not copy
Не удалось проверить обновления: ⇒ Could not check for updates:
У вас последняя версия ⇒ You have the latest version
Доступна новая версия ⇒ A new version is available
Обновить ⇒ Update
Что нового ⇒ What's new
Позже ⇒ Later
Скачиваю обновление… ⇒ Downloading the update…
Новая версия скачана рядом с программой: ⇒ The new version was downloaded next to the app:
. Закройте эту и запустите новую — проекты и пресеты сохранятся. ⇒ . Close this one and run the new one — projects and presets are kept.
Показать файл ⇒ Show file
Ок ⇒ OK
Запускаю установщик… Программа закроется, после установки откройте её снова. ⇒ Starting the installer… The app will close; open it again after installation.
Не удалось скачать обновление: ⇒ Could not download the update:
Ещё раз ⇒ Retry
Закрыть ⇒ Close
поставьте курсор внутрь ролика — стикер берёт 3 секунды от курсора ⇒ put the cursor inside the video — the sticker takes 3 seconds from the cursor
Видеостикер для Telegram: WebM с прозрачным фоном, 512 px по длинной стороне, 3 секунды от курсора ({}), без звука, до 256 КБ. Загрузите его боту @Stickers. ⇒ Telegram video sticker: WebM with a transparent background, 512 px on the long side, 3 seconds from the cursor ({}), no sound, up to 256 KB. Upload it to the @Stickers bot.
GIF без звука · до {}×{} · 15 кадров/с · {} с. Для Telegram и превью лучше держать ролик короче 15 секунд. ⇒ GIF without sound · up to {}×{} · 15 fps · {} s. For Telegram and previews keep it under 15 seconds.
Длина {} с · {} сцен · {}×{} · {} кадров/с · {} кадров ⇒ Length {} s · {} scenes · {}×{} · {} fps · {} frames
{}: вертикальное 1080×1920. Включены зоны интерфейса на превью — держите текст вне красных областей. ⇒ {}: vertical 1080×1920. Interface zones are shown in the preview — keep text out of the red areas.
4K рендерится в несколько раз дольше 1080p. ⇒ 4K renders several times slower than 1080p.
Сначала трек, текст и синхронизация ⇒ Track, lyrics and sync first
(не найдена — кодирует процессор) ⇒ (not found — the CPU encodes)
Готово за {} с: ⇒ Done in {} s:
Готово за {} с: {} ⇒ Done in {} s: {}
Не сохранено ⇒ Not saved
черновик ⇒ draft
Очередь пуста — добавьте версии ⇒ The queue is empty — add versions
отменено ⇒ cancelled
не сохранено ⇒ not saved
Очередь: готово {} из {} ⇒ Queue: {} of {} done
Сохранить кадр ⇒ Save frame
Сохранено: ⇒ Saved:
Не удалось сохранить картинку: ⇒ Could not save the image:
Крупное название ⇒ Big title
Карточка плеера ⇒ Player card
Сохранить PNG… ⇒ Save PNG…
ошибка: ⇒ error:
Добавьте треки, затем вставьте текст к каждому. ⇒ Add tracks, then paste lyrics for each one.
Нет треков для обработки ⇒ No tracks to process
У каждого трека должен быть текст ⇒ Every track needs lyrics
Выберите хотя бы один формат ⇒ Choose at least one format
синхронизация… ⇒ syncing…
экспорт {}… ⇒ exporting {}…
Готово {} из {}. Видео и проекты — в выбранной папке. ⇒ {} of {} done. Videos and projects are in the chosen folder.
Готово {} из {}… ⇒ {} of {} done…
надпись ⇒ caption
выпрыгивает ⇒ pops
проявляется ⇒ fades in
качается ⇒ sways
без анимации ⇒ no animation
цвет текста ⇒ text colour
Положение карточки сброшено ⇒ Card position reset
Версия {} ⇒ Version {}
Версия {} · portable ⇒ Version {} · portable
Прошлый запуск завершился аварийно. ⇒ The last session ended unexpectedly.
Прошлый запуск завершился аварийно ({}). ⇒ The last session ended unexpectedly ({}).
Есть автосохранение. ⇒ An autosave is available.
Есть автосохранение «{}». ⇒ An autosave of “{}” is available.
Отправьте отчёт — это поможет найти причину. ⇒ Send a report — it helps find the cause.
Восстановить проект ⇒ Restore project
Проект восстановлен ⇒ Project restored
Найден несохранённый проект от {}. ⇒ Unsaved project found from {}.
Найден несохранённый проект от {} («{}»). ⇒ Unsaved project found from {} (“{}”).
Восстановить ⇒ Restore
Не нужно ⇒ No thanks
✂ вырезано ⇒ ✂ cut
Скачиваю {}: {}% ⇒ Downloading {}: {}%
Скачиваю {}: {} МБ ⇒ Downloading {}: {} MB
не удалось скачать {}: HTTP {} ⇒ could not download {}: HTTP {}
загрузка {} прервалась, попробуйте ещё раз ⇒ the {} download was interrupted, please try again
обновление ⇒ update
словарь модели ⇒ model vocabulary
модель синхронизации (≈230 МБ, один раз) ⇒ the sync model (≈230 MB, once)
словарь английской модели ⇒ English model vocabulary
английская модель (≈120 МБ, один раз) ⇒ the English model (≈120 MB, once)
модель отделения вокала (≈65 МБ, один раз) ⇒ the vocal separation model (≈65 MB, once)
Читаю трек для отделения вокала… ⇒ Reading the track for vocal separation…
Отделяю вокал от бита: {}% ⇒ Separating vocals from the beat: {}%
Отделяю вокал от бита: {}% · осталось ~{} ⇒ Separating vocals from the beat: {}% · ~{} left
Готовлю движок ({} окно)… ⇒ Preparing the engine ({} window)…
Готовлю движок ({} окна)… ⇒ Preparing the engine ({} windows)…
Кадр {} из {} · осталось ~{} ⇒ Frame {} of {} · ~{} left
Собираю GIF… ⇒ Building the GIF…
Кодирую стикер… ⇒ Encoding the sticker…
Кодирую WebM со звуком… ⇒ Encoding WebM with sound…
Склеиваю видео со звуком… ⇒ Joining the video with sound…
Ужимаю стикер до 256 КБ… ⇒ Squeezing the sticker under 256 KB…
Готово ⇒ Done
Видеокарта не справилась — повторяю на процессоре… ⇒ The graphics card failed — retrying on the CPU…
Читаю звук… ⇒ Reading audio…
Слушаю вокал (нейросеть, английский)… ⇒ Listening to the vocals (neural net, English)…
Считаю спектр… ⇒ Computing the spectrum…
Слушаю вокал (нейросеть)… ⇒ Listening to the vocals (neural net)…
Расставляю слова… ⇒ Placing words…
в тексте нет английских букв для выравнивания ⇒ the lyrics contain no English letters to align
в тексте нет русских букв для выравнивания ⇒ the lyrics contain no Russian letters to align
Синхронизация (dev-сервер)… ⇒ Syncing (dev server)…
Компьютер ⇒ Computer
Система ⇒ System
{} {} {} · {} ядер ⇒ {} {} {} · {} cores
Память ⇒ Memory
{} всего, свободно {} ⇒ {} total, {} free
{} всего, свободно {} — 4K и отделение вокала могут идти медленно ⇒ {} total, {} free — 4K and vocal separation may be slow
Место на диске ⇒ Disk space
свободно {} во временной папке ⇒ {} free in the temp folder
свободно {} во временной папке — для длинного экспорта может не хватить ⇒ {} free in the temp folder — may not be enough for a long export
Временная папка ⇒ Temp folder
запись работает ⇒ writable
не удаётся записать: {} ⇒ cannot write: {}
Видео ⇒ Video
не найден — переустановите программу ⇒ not found — reinstall the app
не запускается: {} — возможно, его блокирует антивирус ⇒ does not start: {} — an antivirus may be blocking it
H.264 — MP4 ⇒ H.264 — MP4
ProRes 4444 — MOV с прозрачностью ⇒ ProRes 4444 — MOV with alpha
VP9 — WebM и стикеры ⇒ VP9 — WebM and stickers
AAC — звук в MP4 ⇒ AAC — sound in MP4
Opus — звук в WebM ⇒ Opus — sound in WebM
нет в сборке ffmpeg ⇒ missing from the ffmpeg build
Кодирование видеокартой ⇒ Graphics card encoding
не найдено — видео кодирует процессор (медленнее, но работает) ⇒ not found — the CPU encodes (slower, but works)
не найдено — видео кодирует процессор ⇒ not found — the CPU encodes
Синхронизация ⇒ Sync
Нейросеть (onnxruntime) ⇒ Neural net (onnxruntime)
загружается ⇒ loads
не найдена — переустановите программу ⇒ not found — reinstall the app
не загружается: {} — установите Microsoft Visual C++ Redistributable ⇒ does not load: {} — install the Microsoft Visual C++ Redistributable
Модель для русского ⇒ Russian model
Модель для английского ⇒ English model
скачана ⇒ downloaded
скачается при первой синхронизации (≈230 МБ) ⇒ downloads on first sync (≈230 MB)
скачается при первой синхронизации на английском (≈120 МБ) ⇒ downloads on first English sync (≈120 MB)
скачается при первой синхронизации ⇒ downloads on first sync
Отделение вокала ⇒ Vocal separation
модель скачана ⇒ model downloaded
модель скачается при первом использовании (≈65 МБ) ⇒ model downloads on first use (≈65 MB)
Сеть ⇒ Network
Доступ к GitHub ⇒ GitHub access
обновления и модели скачиваются ⇒ updates and models can download
GitHub ответил {} ⇒ GitHub replied {}
нет связи ({}) — обновления и модели не скачаются ⇒ no connection ({}) — updates and models won't download
нет ответа за 6 с ⇒ no reply within 6 s
файл не создан ⇒ file not created
готовый файл не читается: {} ⇒ the finished file cannot be read: {}
браузер (dev) ⇒ browser (dev)
English interface ⇒ English interface
нейросеть… ⇒ neural net…
нейросеть ⇒ neural net
Темп и сильные доли определила нейросеть Beat This! ⇒ Tempo and downbeats were found by the Beat This! neural net
Нейросеть уточняет биты… ⇒ The neural net is refining the beats…
быстро ⇒ fast
качественно ⇒ best quality
Быстро — модель MDX. Качественно — HT-Demucs: чище на громком бите, но в 2–4 раза дольше и нужно около 1 ГБ памяти ⇒ Fast — the MDX model. Best quality — HT-Demucs: cleaner on a loud beat, but 2–4× slower and needs about 1 GB of memory
✂ без фона ⇒ ✂ remove background
Нейросеть уберёт фон и оставит человека или предмет ⇒ The neural net removes the background and keeps the person or object
Фон убран ⇒ Background removed
Не удалось убрать фон: ⇒ Could not remove the background:
Нейросеть ищет, где фон… ⇒ The neural net is finding the background…
не удалось открыть картинку ⇒ could not open the image
Лицензии компонентов ⇒ Third-party licenses
Отделяю вокал от бита (качественно): {}% ⇒ Separating vocals from the beat (best quality): {}%
Отделяю вокал от бита (качественно): {}% · осталось ~{} ⇒ Separating vocals from the beat (best quality): {}% · ~{} left
Распознаю слова (нейросеть)… ⇒ Recognising words (neural net)…
модель битов (≈10 МБ, один раз) ⇒ the beat model (≈10 MB, once)
модель распознавания текста (≈225 МБ, один раз) ⇒ the lyrics recognition model (≈225 MB, once)
модель качественного отделения вокала (≈166 МБ, один раз) ⇒ the best-quality vocal separation model (≈166 MB, once)
модель вырезания фона (≈225 МБ, один раз) ⇒ the background removal model (≈225 MB, once)
модель вырезания фона (≈180 МБ, один раз) ⇒ the background removal model (≈180 MB, once)
Распознавание текста (GigaAM v3) ⇒ Lyrics recognition (GigaAM v3)
скачается при первом распознавании (≈225 МБ) ⇒ downloads on first recognition (≈225 MB)
Качественное отделение вокала (HT-Demucs) ⇒ Best-quality vocal separation (HT-Demucs)
скачается при первом использовании (≈166 МБ) ⇒ downloads on first use (≈166 MB)
Биты (Beat This!) ⇒ Beats (Beat This!)
скачается при первой загрузке трека (≈10 МБ) ⇒ downloads when you first load a track (≈10 MB)
Картинки ⇒ Images
Вырезание фона ⇒ Background removal
IS-Net — для BiRefNet нужно от 16 ГБ памяти ⇒ IS-Net — BiRefNet needs 16 GB of memory or more
{}, скачана ⇒ {}, downloaded
{}, скачается при первом использовании (≈{} МБ) ⇒ {}, downloads on first use (≈{} MB)
Темп ⇒ Tempo
Темп трека в ударах в минуту. Определяется сам; если ошибся — впишите свой или простучите ⇒ Track tempo in beats per minute. Detected automatically; if it's wrong, type your own or tap it
вручную ⇒ manual
Вдвое медленнее ⇒ Half as fast
Вдвое быстрее ⇒ Twice as fast
простучать ⇒ tap
Нажимайте в такт музыке 4–8 раз ⇒ Tap along with the music 4–8 times
Определить темп заново ⇒ Detect the tempo again
простукивание · {} ⇒ tapping · {}
Изменить темп ⇒ Change tempo
{} BPM · {} битов ⇒ {} BPM · {} beats
Темп {} BPM — сетка битов пересчитана ⇒ Tempo {} BPM — beat grid recalculated
Темп определён заново: {} BPM ⇒ Tempo re-detected: {} BPM
распознать с трека ⇒ recognise from track
Нейросеть сама расслышит слова, разобьёт их на строки по тактам и сразу расставит по времени ⇒ The neural net hears the words, splits them into lines by bars and times them right away
Появление слов ⇒ Word timing
точно как спето ⇒ exactly as sung
подтягивать к 1/8 бита ⇒ snap to 1/8 beat
подтягивать к 1/16 бита ⇒ snap to 1/16 beat
Слово, спетое чуть раньше или позже удара, появляется ровно в долю — текст «стучит» в такт. Сдвиг не больше 60 мс, тайминги в проекте не меняются. ⇒ A word sung slightly before or after a beat appears exactly on it, so the text hits in time. The shift is at most 60 ms and the project timings are not changed.
Заменить текст в поле распознанным с трека? ⇒ Replace the lyrics in the box with the ones recognised from the track?
Распознаю слова… ⇒ Recognising words…
Распознано: {} слов, {} строк. Нейросеть ошибается в сленге и именах: поправьте текст в поле и нажмите «Синхронизировать слова» — тайминги подстроятся под исправления. ⇒ Recognised: {} words, {} lines. The neural net gets slang and names wrong: fix the lyrics in the box and press “Sync words” so the timing follows your fixes.
Распознано: {} слов, {} строк, неуверенно — {}. Нейросеть ошибается в сленге и именах: поправьте текст в поле и нажмите «Синхронизировать слова» — тайминги подстроятся под исправления. ⇒ Recognised: {} words, {} lines, {} uncertain. The neural net gets slang and names wrong: fix the lyrics in the box and press “Sync words” so the timing follows your fixes.
не удалось расслышать слова — попробуйте «сначала отделить вокал» ⇒ couldn't hear any words — try “separate vocals first”
Текст на английском — включил английскую модель ⇒ The lyrics are in English — switched to the English model
Текст на русском — включил русскую модель ⇒ The lyrics are in Russian — switched to the Russian model
текст песни этого трека — одна строка = одна строка на экране; пусто — распознать с трека ⇒ lyrics for this track — one line = one line on screen; leave empty to recognise from the track
Добавьте треки и вставьте текст к каждому — или оставьте поле пустым, тогда текст распознается с трека. ⇒ Add tracks and paste lyrics for each — or leave the box empty and the lyrics will be recognised from the track.
Каждый трек: синхронизация (или распознавание текста, если поле пустое) → умная обрезка → сцены (с подбором по словам) → авто-акценты → экспорт в текущем стиле, эффектах и звуках. Рядом с видео сохраняется проект .lsp, его можно открыть и поправить. ⇒ Each track: sync (or lyric recognition if the box is empty) → smart trim → scenes (matched to the words) → auto accents → export in the current style, effects and sounds. A .lsp project is saved next to each video so you can open and tweak it.
текст песни этого трека — одна строка = одна строка на экране ⇒ lyrics for this track — one line = one line on screen
Выше ⇒ Up
Ниже ⇒ Down
Перейти к стикеру ⇒ Go to sticker
Убрать вырез ⇒ Remove cut
Удалить пресет ⇒ Delete preset
до какой секунды ⇒ until second
с какой секунды ⇒ from second
наклон, ° ⇒ tilt, °
размер ⇒ size
плашка ⇒ backing
-стикер ⇒ -sticker
-черновик ⇒ -draft
-кадр ⇒ -frame
кадр ⇒ frame
-обложка- ⇒ -cover-
обложка ⇒ cover
новый проект • ⇒ new project •
{} • ⇒ {} •
{}. {} ⇒ {}. {}
`;
  // отдельные слова для строк, собранных из кусочков (очередь экспорта, единицы)
  const NB = '(?![А-Яа-яЁё])', W = (re, to) => [new RegExp(re.replace(/\\b/g, NB), 'g'), to];
  const WORDS = [W('(\\d)\\s?мин\\b', '$1 min'), W('(\\d)\\s?с\\b', '$1 s'), W('(\\d)\\s?МБ\\b', '$1 MB'), W('(\\d)\\s?ГБ\\b', '$1 GB'), W('(\\d)\\s?КБ\\b', '$1 KB'), W('к/с', 'fps'), W('черновик', 'draft'), W('кадров/с', 'fps'), W('сцен\\b', 'scenes'), W('ядер', 'cores')];
  const DICT = new Map(), PAT = [];
  const reEsc = s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  for (const line of RAW.split('\n')) {
    const i = line.indexOf(' ⇒ '); if (i < 0) continue;
    const ru = line.slice(0, i).trim(), en = line.slice(i + 3).trim(); if (!ru) continue;
    if (ru.includes('{}')) { PAT.push([new RegExp('^' + ru.split('{}').map(reEsc).join('([\\s\\S]+?)') + '$'), en]); continue; }
    DICT.set(ru, en);
    if (/:$/.test(ru)) PAT.push([new RegExp('^' + reEsc(ru) + '\\s*([\\s\\S]+)$'), en + ' {}']);
  }
  // длинные шаблоны раньше коротких, чтобы «Готово за {} с: {}» не съел «{} с»
  PAT.sort((a, b) => b[0].source.length - a[0].source.length);
  const CY = /[А-Яа-яЁё]/;
  function T(s, depth = 0) {
    if (s == null) return s; s = String(s);
    if (window.LANG !== 'en' || !CY.test(s)) return s;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2];
    if (DICT.has(core)) return m[1] + DICT.get(core) + m[3];
    if (depth < 3) for (const [re, en] of PAT) {
      const r = core.match(re); if (!r) continue;
      let k = 1; return m[1] + en.replace(/\{\}/g, () => T(r[k++] ?? '', depth + 1)) + m[3];
    }
    let out = core; for (const [re, to] of WORDS) out = out.replace(re, to);
    return m[1] + out + m[3];
  }
  window.T = T;
  if (window.LANG !== 'en') return;
  document.documentElement.lang = 'en';
  // системные окна подтверждения
  const _c = window.confirm.bind(window), _a = window.alert.bind(window), _p = window.prompt.bind(window);
  window.confirm = m => _c(T(m)); window.alert = m => _a(T(m)); window.prompt = (m, d) => _p(T(m), d);
  const ATTRS = ['title', 'placeholder', 'data-tip', 'aria-label'];
  const skip = el => !el || el.closest('[data-notr],textarea,script,style');
  function trNode(n) {
    if (n.nodeType === 3) { if (CY.test(n.nodeValue) && !skip(n.parentElement)) { const v = T(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } return; }
    if (n.nodeType !== 1 || n.closest('[data-notr]')) return;
    for (const a of ATTRS) { const v = n.getAttribute(a); if (v && CY.test(v)) n.setAttribute(a, T(v)); }
    if (/^(TEXTAREA|SCRIPT|STYLE)$/.test(n.tagName)) return;
    if (n.tagName === 'INPUT' && (n.type === 'button' || n.type === 'submit') && CY.test(n.value)) n.value = T(n.value);
    for (let c = n.firstChild; c; c = c.nextSibling) trNode(c);
  }
  window.translateDom = root => trNode(root || document.body);
  const mo = new MutationObserver(list => {
    for (const r of list) {
      if (r.type === 'characterData') trNode(r.target);
      else if (r.type === 'attributes') { const v = r.target.getAttribute(r.attributeName); if (v && CY.test(v) && !r.target.closest('[data-notr]')) r.target.setAttribute(r.attributeName, T(v)); }
      else r.addedNodes.forEach(trNode);
    }
  });
  const start = () => { trNode(document.body); document.title = T(document.title); mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
