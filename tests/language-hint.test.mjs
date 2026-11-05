import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMostlyEnglish, languageSection } from "../lib/language-hint.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");
const words = (text, times = 1) => Array.from({ length: times }, () => text).join(" ").split(/\s+/).map((t) => ({ text: t }));

const english = "so what we are going to do is just try this and see if it works because I think that you can do it with the other one and we have the time";
const portuguese = "Bora lá, bora lá, a gente tá indo para batalha. Checa suas armas e equipamentos. Soldado inimigo chegando. Todas as estações, sinal verde. Mobilizem, mostrem quem manda. Cuidado, o gás tá chegando! Vai para zona segura!";
const spanish = "Ya estamos en vivo ahí, loco. Bueno, ahora la retransmisión. ¿Cómo se pone no molestar acá, boludo? El de tu lado, vamos a ver si se escucha bien todo esto por favor.";
const german = "Hey Leute, herzlich willkommen zu einem neuen Video auf meinem Kanal. Heute sind wir in Braunschweig und schauen uns ganz genau an, was hier los ist.";
const russian = "Сегодня мы разберем главные ошибки каждого левела. Начнем от самых низких и дойдем до десятого уровня. Так ты точно сможешь понять.";

test("English streams stay English; Portuguese, Spanish, German and Russian are not", () => {
  assert.equal(isMostlyEnglish(words(english, 8)), true);
  assert.equal(isMostlyEnglish(words(portuguese, 4)), false);
  assert.equal(isMostlyEnglish(words(spanish, 4)), false);
  assert.equal(isMostlyEnglish(words(german, 5)), false);
  assert.equal(isMostlyEnglish(words(russian, 5)), false);
});

test("a transcript too short to judge counts as English, so nothing changes for it", () => {
  assert.equal(isMostlyEnglish(words("hola amigos", 5)), true);
  assert.equal(isMostlyEnglish([]), true);
});

test("the prompt note asks for titles and hooks in the streamer's language, without defaulting to English", () => {
  const note = languageSection();
  assert.ok(note.includes("## LANGUAGE") && note.includes("language the streamer actually speaks") && note.includes("Do not default to English"));
});

test("the pipeline adds the note and a separate saved-result key only for non-English streams", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  assert.ok(pipeline.includes("const nonEnglish = !isMostlyEnglish(words);"));
  assert.ok(pipeline.includes('const languageNote = nonEnglish ? languageSection() : "";'));
  assert.ok(pipeline.includes('nonEnglish ? "lang-v1" : ""'));
  assert.equal(pipeline.split("loudMoments, quietStream, nonEnglish, emotionSection));").length - 1, 2, "both clip-picking calls pass it (and the emotion peaks)");
});
