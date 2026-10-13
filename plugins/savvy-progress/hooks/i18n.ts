

// ---------------------------------------------------------------------------
// Language: the `language` option, else Claude Code's `language` setting, else the
// process locale; English when nothing says Hebrew or Russian.

export type Lang = 'en' | 'ru' | 'he'

export const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    apiCost: 'API cost',
    details: 'Details',
    tokens: 'Tokens',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    tokensWord: 'tokens',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    steps: 'Steps',
    stepActive: 'working on',
    stepPending: 'pending',
    stepDone: 'complete',
    context: 'Context',
    sessionLimit: 'Session limit',
    weeklyLimit: 'Weekly limit',
    resetsIn: 'resets in',
    background: 'Background',
    bgRunning: 'running',
    bgCompleted: 'finished',
    bgFailed: 'failed',
    bgKilled: 'stopped',
    silentFor: 'no output for',
    waitingOutput: 'waiting for output…',
    ctx: 'ctx',
    tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    ctxWord: 'context',
    file: 'file',
    files: 'files',
    filesFew: 'files',
    changed: 'changed',
    finder: 'Finder',
    diff: 'Diff',
    hideDiff: 'Hide diff',
    noChanges: 'No changes left in this file.',
    tooBig: 'No diff for this file: too large, or diff could not run.',
    fileRead: 'read',
    fileNew: 'new',
    edits: 'edits',
    revealFailed: 'Could not show the file',
  },
  ru: {
    pane: 'Агенты',
    cost: 'Стоимость',
    apiCost: 'Цена по API',
    details: 'Подробнее',
    tokens: 'Токены',
    time: 'Время',
    collapse: 'Свернуть',
    expand: 'Развернуть',
    running: 'Работают',
    finished: 'Завершены',
    planned: 'Запланированы',
    empty: 'Субагентов пока нет.',
    round: 'раунд',
    failed: 'ошибка',
    after: 'после',
    tokensWord: 'токенов',
    agentsCount: 'агентов',
    isRunning: 'работает',
    isFinished: 'завершён',
    isPlanned: 'запланирована',
    opened: 'Панель агентов открыта.',
    closed: 'Панель агентов закрыта.',
    done: 'Готово',
    plan: 'План',
    design: 'Дизайн',
    tasks: 'Задачи',
    review: 'Ревью',
    busy: 'в работе',
    steps: 'Шаги',
    stepActive: 'в работе',
    stepPending: 'ожидает',
    stepDone: 'готово',
    context: 'Контекст',
    sessionLimit: 'Лимит сессии',
    weeklyLimit: 'Недельный лимит',
    resetsIn: 'сброс через',
    background: 'Фоновые задачи',
    bgRunning: 'работает',
    bgCompleted: 'завершена',
    bgFailed: 'ошибка',
    bgKilled: 'остановлена',
    silentFor: 'нет вывода',
    waitingOutput: 'ждём вывода…',
    ctxWord: 'контекста',
    file: 'файл',
    files: 'файлов',
    filesFew: 'файла',
    changed: 'изменено',
    finder: 'Finder',
    diff: 'Дифф',
    hideDiff: 'Скрыть дифф',
    noChanges: 'В этом файле не осталось изменений.',
    tooBig: 'Диффа нет: файл слишком большой или diff не запустился.',
    fileRead: 'прочитан',
    fileNew: 'новый',
    edits: 'правок',
    revealFailed: 'Не удалось показать файл',
    ctx: 'ctx',
    tier: { light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other' },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
  he: {
    pane: 'סוכנים',
    cost: 'עלות',
    tokens: 'טוקנים',
    time: 'זמן',
    collapse: 'כיווץ',
    expand: 'הרחבה',
    running: 'פועלים',
    finished: 'הסתיימו',
    planned: 'מתוכננים',
    empty: 'עדיין אין סוכנים.',
    round: 'סבב',
    failed: 'שגיאה',
    after: 'אחרי',
    tokensWord: 'טוקנים',
    agentsCount: 'סוכנים',
    isRunning: 'פועל',
    isFinished: 'הסתיים',
    isPlanned: 'מתוכנן',
    opened: 'חלונית הסוכנים נפתחה.',
    closed: 'חלונית הסוכנים נסגרה.',
    done: 'הושלם',
    plan: 'תכנון',
    design: 'עיצוב',
    tasks: 'משימות',
    review: 'בדיקה',
    busy: 'בעבודה',
    ctx: 'הקשר',
    tier: { light: 'קל', medium: 'בינוני', careful: 'זהיר', heavy: 'כבד', fable: 'פייבל', other: 'אחר' },
    effort: { low: 'נמוך', medium: 'בינוני', high: 'גבוה', xhigh: 'גבוה מאוד', max: 'מקסימלי' },
    apiCost: 'עלות API',
    details: 'פרטים',
    steps: 'שלבים',
    stepActive: 'בעבודה',
    stepPending: 'ממתין',
    stepDone: 'הושלם',
    context: 'הקשר',
    sessionLimit: 'מגבלת סשן',
    weeklyLimit: 'מגבלה שבועית',
    resetsIn: 'מתאפס בעוד',
    background: 'ברקע',
    bgRunning: 'פועל',
    bgCompleted: 'הסתיים',
    bgFailed: 'נכשל',
    bgKilled: 'נעצר',
    silentFor: 'אין פלט כבר',
    waitingOutput: 'ממתין לפלט…',
    ctxWord: 'הקשר',
    file: 'קובץ',
    files: 'קבצים',
    filesFew: 'קבצים',
    changed: 'שונו',
    finder: 'Finder',
    diff: 'שינויים',
    hideDiff: 'הסתרת שינויים',
    noChanges: 'לא נשארו שינויים בקובץ הזה.',
    tooBig: 'אין תצוגת שינויים לקובץ הזה: הוא גדול מדי, או ש-diff לא רץ.',
    fileRead: 'נקרא',
    fileNew: 'חדש',
    edits: 'עריכות',
    revealFailed: 'לא ניתן להציג את הקובץ',
  },
} as const

// Module scope is fine here: session.start sets it again on every (re)load.
let lang: Lang = 'en'
export const setLang = (l: Lang): void => {
  lang = l
}
// A language that lacks a label shows it in English, so one added before or
// after a new label never draws `undefined`.
export const withEnglish = new Map<Lang, (typeof STRINGS)['en']>()
export const tr = (): (typeof STRINGS)['en'] => {
  let s = withEnglish.get(lang)
  if (!s) {
    s = { ...STRINGS.en, ...STRINGS[lang] } as (typeof STRINGS)['en']
    withEnglish.set(lang, s)
  }
  return s
}

// Hebrew draws every row mirrored: crab and title on the right, numbers on the left.
export const isRtl = () => lang === 'he'

// Tier and effort words as shown; anything unknown shows as it came.
export const tierWord = (tier: string): string => (tr().tier as Record<string, string>)[tier] ?? tier
export const effortWord = (effort: string): string => (tr().effort as Record<string, string>)[effort] ?? effort

export const isRussian = (v: unknown): boolean => typeof v === 'string' && /^(ru|russian|рус)/i.test(v.trim())
export const isHebrew = (v: unknown): boolean => typeof v === 'string' && /^(he|iw|hebrew|עברית)/i.test(v.trim())
export const langOf = (v: unknown): Lang => (isHebrew(v) ? 'he' : isRussian(v) ? 'ru' : 'en')

// "1 file", "3 files"; Russian has a third form for 2-4 (but not 12-14).
export const filesWord = (n: number): string => {
  const s = tr()
  const last = n % 10
  const lastTwo = n % 100
  if (last === 1 && lastTwo !== 11) return s.file
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return s.filesFew
  return s.files
}
