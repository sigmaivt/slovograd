// Проверка lesson.json без зависимостей.
//
// Прототип и эталон для engine/validate.ts (задача B3). Здесь живут те правила,
// которые JSON Schema выразить не может: совпадение буквы с позицией в слове,
// ударение на гласной, согласованность проверочного слова.
//
//   node tools/skill/check-lesson.mjs путь/к/lesson.json
//
// Код возврата 1, если есть жёсткие нарушения.

import { readFileSync } from "node:fs";

const CODES = new Set([
  "ROOT_VOWEL_CHECK", "ROOT_DICT", "ROOT_PAIRED_CONS", "ROOT_SILENT_CONS",
  "DOUBLE_CONS", "HUSHING", "SEP_SIGNS", "SOFT_SIGN_NOUN", "PREFIX_PREP",
  "NOUN_ENDING", "ADJ_ENDING", "VERB_ENDING", "VERB_SOFT_SIGN", "TSYA",
  "NE_VERB", "PAST_SUFFIX", "ADVERB_O_A", "PRON_PREP",
  // Суффиксы существительных. Добавлены после задачи 0.3: упр. 111 целиком
  // про них, а в каталоге из ТЗ их не было — урок тренировал не тот навык.
  "SUFFIX_IK_EK", "SUFFIX_CUB", "SUFFIX_DIM", "SUFFIX_CONST",
  // -ок/-ек после шипящих (крючок, орешек). Добавлен в задаче 0.5.
  "SUFFIX_O_E_HUSH",
  // Из памятки «Орфограммы» в учебнике (задача 0.5)
  "SOFT_SIGN_MARK", "PREFIX_SPELL", "COMPOUND_VOWEL", "CAPITAL_PROPER",
  // Родовые окончания прилагательных — отдельная строка памятки части 2
  "ADJ_GENDER"
]);

const VOWELS = "аеёиоуыэюя";

/**
 * Под ударением «е» закономерно переходит в «ё»: весна — вёсны, пчела — пчёлы.
 * Для сверки проверочного слова это одна и та же гласная.
 */
const sameVowel = (a, b) => a === b || (a + b === "её") || (a + b === "ёе");

/** Жёсткие нарушения блокируют импорт, мягкие поднимают needsReview. */
export function checkLesson(lesson) {
  const hard = [];
  const soft = [];

  const at = (w, i) => `${w.id} «${w.text}» орфограмма ${i + 1}`;

  if (lesson.schemaVersion !== 1) hard.push(`schemaVersion должен быть 1, а не ${lesson.schemaVersion}`);
  if (!Array.isArray(lesson.words) || !lesson.words.length) {
    hard.push("В уроке нет слов");
    return { hard, soft, ok: false };
  }

  // Текст для ребёнка: коротко и обращаясь к девочке (правила из первой игры).
  // Мягкие флаги: пусть родитель посмотрит, импорт не блокируем.
  const MASC = /(^|[^а-яё])(увидел|нашёл|нашел|написал|услышал|проверил|запомнил|понял)([^а-яё]|$)/i;
  for (const r of lesson.rules ?? []) {
    const n = (r.kidExplanation ?? "").split(/\s+/).filter(Boolean).length;
    if (n > 25) soft.push(`правило ${r.code}: объяснение ${n} слов, надо не больше 25`);
    for (const t of [r.kidExplanation, ...(r.steps ?? []), ...(r.examples ?? [])]) {
      const m = (t ?? "").match(MASC);
      if (m) soft.push(`правило ${r.code}: «${m[2]}» — мужской род, а играет девочка`);
      // {е} — выделение буквы; скобки должны быть парными, внутри 1–4 буквы
      const s = t ?? "";
      if ((s.match(/\{/g) || []).length !== (s.match(/\}/g) || []).length || /\{[^}]*\{/.test(s)) {
        soft.push(`правило ${r.code}: непарные фигурные скобки в «${s}»`);
      } else {
        for (const [, inner] of s.matchAll(/\{([^}]*)\}/g)) {
          if (!/^[а-яё]{1,4}$/i.test(inner)) soft.push(`правило ${r.code}: в скобках «{${inner}}» — ожидается одна буква или сочетание до 4 букв`);
        }
      }
    }
  }

  const seenIds = new Set();

  for (const w of lesson.words) {
    const letters = Array.from(w.text ?? "");

    if (seenIds.has(w.id)) hard.push(`Повторяющийся id слова: ${w.id}`);
    seenIds.add(w.id);

    // Ударение обязано стоять на гласной.
    if (typeof w.stressIndex !== "number") {
      hard.push(`${w.id} «${w.text}»: нет stressIndex`);
    } else {
      const c = letters[w.stressIndex];
      if (!c) hard.push(`${w.id} «${w.text}»: stressIndex ${w.stressIndex} выходит за пределы слова (${letters.length} букв)`);
      else if (!VOWELS.includes(c)) hard.push(`${w.id} «${w.text}»: stressIndex ${w.stressIndex} указывает на «${c}» — это не гласная`);
    }

    if (letters.length < 3) soft.push(`${w.id} «${w.text}»: слово короче 3 букв`);
    if ((w.orthograms?.length ?? 0) > 3) soft.push(`${w.id} «${w.text}»: больше 3 орфограмм в одном слове`);

    const spans = [];

    (w.orthograms ?? []).forEach((o, i) => {
      if (!CODES.has(o.type)) hard.push(`${at(w, i)}: неизвестный код «${o.type}»`);

      // Главная проверка: буква-ответ стоит там, где указано.
      const actual = letters.slice(o.index, o.index + o.length).join("");
      if (o.index + o.length > letters.length) {
        hard.push(`${at(w, i)}: позиция ${o.index}+${o.length} выходит за пределы слова (${letters.length} букв)`);
      } else if (actual !== o.correct) {
        hard.push(`${at(w, i)}: на позиции ${o.index} стоит «${actual}», а correct = «${o.correct}»`);
      }

      if (!Array.isArray(o.distractors) || !o.distractors.length) {
        hard.push(`${at(w, i)}: пустой distractors`);
      } else if (o.distractors.includes(o.correct)) {
        hard.push(`${at(w, i)}: distractors содержит верный ответ «${o.correct}»`);
      }

      spans.push([o.index, o.index + o.length, i]);

      const m = o.method ?? {};
      if (m.kind === "check_word") {
        const cw = Array.from(m.checkWord ?? "");
        const sc = cw[m.checkStressIndex];
        if (!sc) {
          hard.push(`${at(w, i)}: checkStressIndex ${m.checkStressIndex} выходит за пределы «${m.checkWord}»`);
        } else if (!VOWELS.includes(sc)) {
          hard.push(`${at(w, i)}: checkStressIndex указывает на «${sc}» в «${m.checkWord}» — это не гласная`);
        } else if (o.type === "ROOT_VOWEL_CHECK" && !sameVowel(sc, o.correct)) {
          // Весь смысл проверочного слова: под ударением слышна та же буква.
          hard.push(`${at(w, i)}: в «${m.checkWord}» под ударением «${sc}», а проверяем «${o.correct}» — проверочное слово не подходит`);
        }

        // Эвристика на общий корень: морфологии у нас нет, поэтому только флаг.
        // Считаем по ё→е, иначе «весна/вёсны» дало бы ложную тревогу.
        const flat = s => s.replace(/ё/g, "е");
        const a = flat(w.text), b = flat(m.checkWord ?? "");
        let common = 0;
        while (common < a.length && common < b.length && a[common] === b[common]) common++;
        // Короткий корень — не повод для тревоги: если слово целиком уложилось
        // в начало другого, корень совпал. «ёж» → «ежонок» это законная пара.
        const shorter = Math.min(a.length, b.length);
        if (common < 3 && common < shorter) {
          soft.push(`${at(w, i)}: у «${w.text}» и «${m.checkWord}» общее начало всего ${common} букв — проверь корень`);
        }
      }

      if (m.kind === "mnemonic") {
        const text = (m.mnemonic ?? "").toLowerCase();
        if (!text.includes(o.correct.toLowerCase()) && !text.includes(w.text.toLowerCase())) {
          soft.push(`${at(w, i)}: зацепка не упоминает ни букву «${o.correct}», ни само слово`);
        }
      }

      if (o.confidence !== "high" && !o.needsReview) {
        soft.push(`${at(w, i)}: confidence = ${o.confidence}, но needsReview не выставлен`);
      }
    });

    // Орфограммы одного слова не должны перекрываться.
    spans.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < spans.length; k++) {
      if (spans[k][0] < spans[k - 1][1]) {
        hard.push(`${w.id} «${w.text}»: орфограммы ${spans[k - 1][2] + 1} и ${spans[k][2] + 1} перекрываются по позициям`);
      }
    }
  }

  return { hard, soft, ok: hard.length === 0 };
}

// --- запуск из командной строки ------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const path = process.argv[2];
  if (!path) {
    console.error("Использование: node tools/skill/check-lesson.mjs путь/к/lesson.json");
    process.exit(2);
  }
  const lesson = JSON.parse(readFileSync(path, "utf8"));
  const { hard, soft, ok } = checkLesson(lesson);

  console.log(`Слов в уроке: ${lesson.words?.length ?? 0}`);
  if (hard.length) {
    console.log(`\nЖЁСТКИЕ нарушения — импорт будет отклонён (${hard.length}):`);
    hard.forEach(m => console.log("  ✗ " + m));
  }
  if (soft.length) {
    console.log(`\nНа проверку родителю (${soft.length}):`);
    soft.forEach(m => console.log("  ? " + m));
  }
  if (ok && !soft.length) console.log("\nВсё чисто.");
  else if (ok) console.log("\nЖёстких нарушений нет — урок импортируется.");
  process.exit(ok ? 0 : 1);
}
