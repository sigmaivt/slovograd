/* Общие для игры и кабинета чтение содержимого и хранение прогресса.
 *
 * Разделение принципиальное:
 *   содержимое (уроки, ручные слова, исключения) — в репозитории, правит родитель;
 *   прогресс (сколько раз верно и сколько с ошибкой) — в памяти устройства.
 *
 * Писать в репозиторий из браузера нельзя: для этого нужен токен, а токен
 * на странице у ребёнка означает доступ к репозиторию для кого угодно.
 * Поэтому связь односторонняя: приложение только читает.
 */
(function(){

// Каталог орфограмм. В приложении придёт из schema/orthograms.ts (задача A3).
const CODES = {
  ROOT_VOWEL_CHECK:"Безударная гласная в корне (проверяемая)",
  ROOT_DICT:"Словарное слово",
  ROOT_PAIRED_CONS:"Парная согласная в корне",
  ROOT_SILENT_CONS:"Непроизносимая согласная",
  DOUBLE_CONS:"Двойные согласные",
  HUSHING:"После шипящих; чк, чн, нч, щн",
  SEP_SIGNS:"Разделительные ъ и ь",
  SOFT_SIGN_MARK:"Ь для мягкости",
  SOFT_SIGN_NOUN:"Ь после шипящих у существительных",
  PREFIX_SPELL:"Гласные и согласные в приставках",
  PREFIX_PREP:"Приставка или предлог",
  COMPOUND_VOWEL:"Соединительные о и е",
  CAPITAL_PROPER:"Заглавная буква в именах",
  NOUN_ENDING:"Окончания существительных",
  ADJ_GENDER:"Родовые окончания прилагательных",
  ADJ_ENDING:"Падежные окончания прилагательных",
  VERB_ENDING:"Личные окончания глаголов",
  VERB_SOFT_SIGN:"Ь после шипящих у глаголов",
  TSYA:"-тся и -ться",
  NE_VERB:"Не с глаголами",
  PAST_SUFFIX:"Суффикс прошедшего времени",
  PRON_PREP:"Предлоги с местоимениями",
  ADVERB_O_A:"Наречия на -о и -а",
  SUFFIX_IK_EK:"Суффиксы -ик и -ек",
  SUFFIX_CUB:"Суффиксы детёнышей",
  SUFFIX_DIM:"Ласкательные суффиксы",
  SUFFIX_CONST:"Постоянные суффиксы",
  SUFFIX_O_E_HUSH:"Суффиксы -ок и -ек после шипящих"
};

const K_STATS = "slovograd.stats";     // прогресс: ключ слова → верно/с ошибкой
const K_CACHE = "slovograd.content";   // скачанное содержимое, чтобы работать без сети

const keyOf = w => w.t + "|" + w.i + "|" + w.type;

function loadStats(){
  try{ return JSON.parse(localStorage.getItem(K_STATS) || "{}"); }catch(e){ return {}; }
}
function saveStats(stats){
  try{ localStorage.setItem(K_STATS, JSON.stringify(stats)); }catch(e){}
}

// слово из урока (формат lesson.json от генератора)
function fromLesson(w){
  const o = (w.orthograms || []).find(x => x.length === 1 && CODES[x.type]);
  const bad = o && (o.distractors || []).find(d => d.length === 1 && d !== o.correct);
  if(!o || !bad) return null;
  return {t:w.text, em:w.emoji || "📘", i:o.index, ok:o.correct, bad,
          type:o.type, ctx:w.context || w.text, m:o.method || null};
}

// слово, добавленное руками (формат manual.json — попроще, его правят вручную)
function fromManual(w){
  if(!w || !w.text || !CODES[w.type]) return null;
  const letters = Array.from(w.text);
  if(!(w.index >= 0 && w.index < letters.length)) return null;
  if(letters[w.index] !== w.correct || !w.wrong || w.wrong === w.correct) return null;
  return {t:w.text, em:w.emoji || "✏️", i:w.index, ok:w.correct, bad:w.wrong,
          type:w.type, ctx:w.context || w.text,
          m:w.hint ? {kind:"mnemonic", mnemonic:w.hint} : null};
}

async function getJSON(url){
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(),
                        {cache:"no-store"});
  if(!r.ok) throw new Error(url + " → " + r.status);
  return r.json();
}

/** Читает содержимое из репозитория. Нет сети — берёт последнее скачанное. */
async function fetchContent(base){
  try{
    const index = await getJSON(base + "index.json");
    const lessons = [], words = [], bad = [];

    for(const l of (index.lessons || [])){
      if(l.active === false) continue;
      try{
        const pack = await getJSON(base + l.file);
        const got = [];
        for(const w of (pack.words || [])){
          const c = fromLesson(w);
          if(c) got.push({...c, src:[l.id]}); else bad.push(w.text + " (" + l.id + ")");
        }
        lessons.push({id:l.id, title:l.title || pack.title || l.id, n:got.length});
        words.push(...got);
      }catch(e){ bad.push("урок " + l.id + ": " + e.message); }
    }

    if(index.manual){
      try{
        const man = await getJSON(base + index.manual);
        for(const w of (man.words || [])){
          const c = fromManual(w);
          if(c) words.push({...c, src:["manual"]});
          else bad.push((w && w.text ? w.text : "слово") + " (вручную)");
        }
        if(man.words && man.words.length) lessons.push({id:"manual", title:"Добавленные вручную",
          n:words.filter(w => w.src.includes("manual")).length});
      }catch(e){ bad.push("ручные слова: " + e.message); }
    }

    const content = {words, lessons, excluded:index.excluded || [], hard:index.hard || [],
                     updated:index.updated || "", bad};
    try{ localStorage.setItem(K_CACHE, JSON.stringify(content)); }catch(e){}
    return {...content, offline:false};
  }catch(e){
    try{
      const c = JSON.parse(localStorage.getItem(K_CACHE) || "null");
      if(c) return {...c, offline:true};
    }catch(err){}
    return {words:[], lessons:[], excluded:[], hard:[], bad:[], offline:true, error:e.message};
  }
}

/** Собирает рабочий список слов: содержимое + прогресс с устройства. */
function buildPool(content, stats){
  const excluded = new Set(content.excluded || []);
  const forced = new Set(content.hard || []);
  const byKey = new Map();

  for(const w of content.words){
    const k = keyOf(w);
    if(excluded.has(k)) continue;
    const old = byKey.get(k);
    if(old){                                   // слово из двух источников — одно
      old.src = [...new Set(old.src.concat(w.src))];
      old.m = old.m || w.m;
      continue;
    }
    byKey.set(k, {...w, st:stats[k] || {ok:0, err:0}, forceHard:forced.has(k)});
  }
  return [...byKey.values()];
}

/** Трудное: помечено родителем в репозитории или ошибок не меньше, чем верных. */
function isHard(w){
  if(w.forceHard) return true;
  const s = w.st || {ok:0, err:0};
  return s.err > 0 && s.err >= s.ok;
}

window.SG = {CODES, keyOf, loadStats, saveStats, fetchContent, buildPool, isHard};

})();
