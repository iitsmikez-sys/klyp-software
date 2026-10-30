import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewClipBatch } from '../lib/clip-boundaries.ts';

const clip = (start_seconds, end_seconds, thumbnail_seconds, overrides = {}) => ({
  start_seconds, end_seconds, thumbnail_seconds,
  title: 'A funny moment', reason: 'A complete reaction.',
  ...overrides,
});
const word = (text, start, end = start + 0.3) => ({ text, start: start * 1000, end: end * 1000 });
const flags = result => result.flagged.flatMap(item => item.flags);

test('a relative thumbnail offset becomes an absolute timestamp inside its clip', () => {
  const source = clip(4780, 4840, 25);
  const result = reviewClipBatch([source], [word('Setup.', 4781), word('Payoff!', 4838)], 7395);
  assert.equal(result.ready.length, 1);
  assert.equal(result.ready[0].thumbnail_seconds, 4805);
  assert.equal(source.thumbnail_seconds, 25, 'source result remains unchanged');
});

test('a thumbnail on the exclusive end boundary is moved inside the clip', () => {
  const result = reviewClipBatch([clip(100, 160, 160)], [word('Setup.', 101), word('Done!', 158)], 1000);
  assert.equal(result.ready.length, 0);
  assert.equal(result.flagged[0].clip.thumbnail_seconds, 130);
  assert.ok(flags(result).includes('thumbnail_needs_review'));
});
test('an unusable thumbnail falls back inside the window and is flagged for review', () => {
  const result = reviewClipBatch([clip(100, 130, -80)], [word('Setup.', 101), word('Done!', 125)], 1000);
  assert.equal(result.ready.length, 0);
  assert.equal(result.flagged[0].clip.thumbnail_seconds, 115);
  assert.deepEqual(flags(result), ['thumbnail_needs_review']);
});

test('overlong clips are not shortened or delivered even when the payoff is at the end', () => {
  const source = clip(100, 166, 160, { reason: 'The answer is at the end.' });
  const result = reviewClipBatch([source], [word('Setup.', 101), word('Answer!', 164)], 1000);
  assert.equal(result.ready.length, 0);
  assert.equal(result.flagged[0].clip.end_seconds, 166);
  assert.ok(flags(result).includes('duration_over_60s'));
});

test('a clip ending inside a sentence extends through its nearby ending', () => {
  // Pilot VOD 2901248464: Sonnet France clip ends at 2880 as the correction begins.
  const source = clip(2820, 2880, 30, { title: 'France is in England' });
  const words = [word('France', 2838), word('Tower', 2879.4, 2880), word("isn't", 2880.1, 2880.5), word('England.', 2880.6)];
  const result = reviewClipBatch([source], words, 7395);
  assert.equal(result.ready.length, 1);
  assert.equal(result.ready[0].thumbnail_seconds, 2850);
  assert.ok(result.ready[0].end_seconds > 2880.6);
});

test('a question with a nearby answer extends or remains flagged for review', () => {
  // Pilot VOD 2901248464: Sonnet would-you-rather ends at 7060; answer starts at 7062.
  const source = clip(7000, 7060, 7015, { reason: 'Her deadpan answer makes the clip.' });
  const words = [word('Would', 7020), word('poll?', 7057, 7057.4), word('Um,', 7062), word('I', 7062.5), word('would', 7063), word('answer.', 7064)];
  const result = reviewClipBatch([source], words, 7395);
  assert.equal(result.ready.length, 0);
  assert.ok(result.flagged[0].clip.end_seconds > 7064);
});

test('a long silent introduction is flagged without removing context automatically', () => {
  const source = clip(4500, 4550, 4520);
  const result = reviewClipBatch([source], [word('What?', 4511), word('Done.', 4540)], 5321);
  assert.ok(flags(result).includes('opening_silence'));
  assert.equal(result.flagged[0].clip.start_seconds, 4500);
});

test('a cut starting inside an ongoing sentence is flagged as potentially missing context', () => {
  const source = clip(100, 130, 115);
  const words = [word('because', 99.5, 99.8), word('this', 100.1), word('works.', 101), word('Payoff!', 120)];
  assert.ok(flags(reviewClipBatch([source], words, 1000)).includes('possible_missing_context'));
});

test('a complete sixty-second clip passes without a spurious sentence warning', () => {
  const source = clip(100, 160, 140);
  const words = [word('Setup.', 101), word('Punchline!', 158), word('Next', 164), word('topic.', 165)];
  const result = reviewClipBatch([source], words, 1000);
  assert.deepEqual(result.flagged, []);
  assert.equal(result.ready.length, 1);
});

test('invalid, out-of-VOD and too-short windows are withheld from delivery', () => {
  const source = [clip(-1, 20, 5), clip(20, 20, 20), clip(990, 1010, 1000), clip(100, 110, 105), clip(NaN, 130, 115)];
  const result = reviewClipBatch(source, [], 1000);
  assert.equal(result.ready.length, 0);
  assert.equal(result.flagged.length, 5);
  assert.ok(result.flagged.every(item => item.flags.includes('invalid_window') || item.flags.includes('duration_under_15s')));
});

test('saved Sonnet France cut includes the quoted insult after the original end and drops the school preamble', () => {
  const source = clip(2820, 2880, 30, { title: 'Chat convinced her FRANCE is in ENGLAND', reason: "Her 'dunderheads' insult lands after the correction." });
  const words = [word('bro?', 2820.1), word('I', 2820.8), word('learned.', 2822),
    word('Anyways,', 2834.7), word('chill.', 2835.8), word('Okay,', 2836.9),
    word('wait,', 2837.2), word('France', 2840.1), word('England?', 2841.2),
    word('The', 2878.9), word('Eiffel', 2879.1), word('Tower', 2879.4), word("isn't", 2880.1),
    word('in', 2880.4), word('England.', 2880.6), word('The', 2885.2), word('Tower', 2885.4),
    word('is', 2885.6), word('in', 2885.8), word('Paris.', 2886),
    word('Yo,', 2887.4), word('you', 2887.6), word('dunderheads!', 2888)];
  const result = reviewClipBatch([source], words, 7395);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].start_seconds >= 2829);
  assert.ok(result.ready[0].end_seconds > 2888);
  assert.ok(result.ready[0].end_seconds - result.ready[0].start_seconds <= 60);
  assert.ok(result.ready[0].thumbnail_seconds >= result.ready[0].start_seconds);
});

test('saved Sonnet goat cut includes the answer and removes unrelated opening chatter', () => {
  const source = clip(7000, 7060, 15, { title: 'Would you rather with a goat', reason: 'The deadpan answer is the payoff.' });
  const words = [word('late,', 7000), word('guys.', 7000.4), word('What', 7007.7), word('else?', 7008),
    word('Do', 7008.9), word('what', 7009.1), word('snail?', 7009.4), word('Fuck', 7009.7),
    word('it,', 7009.9), word('snail.', 7011), word('Would', 7020.1), word('goat?', 7030),
    word('answer?', 7058.5), word('Mods,', 7061.3), word('poll?', 7062),
    word('Um,', 7063.3), word('I', 7063.7), word('would', 7064), word('goat', 7064.7),
    word('knows.', 7066.5)];
  const result = reviewClipBatch([source], words, 7395);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].start_seconds >= 7007);
  assert.ok(result.ready[0].end_seconds > 7066.5);
  assert.ok(result.ready[0].end_seconds - result.ready[0].start_seconds <= 60);
});

test('saved Opus pro claim cut includes the immediate claim after its old end', () => {
  const source = clip(6445, 6498, 6470, { title: 'You play pro?', reason: 'The pro claim is the payoff.' });
  const words = [word('Yo,', 6446.8), word('hear', 6447), word('me?', 6448),
    word('You', 6467.7), word('play', 6468), word('pro?', 6468.5),
    word('world', 6496), word('championships', 6496.5), word('Fortnite.', 6497.7),
    word('Oh', 6498.7), word('yeah,', 6499), word('I', 6499.5), word('got', 6500),
    word('6', 6500.5), word('of', 6501), word('those.', 6501.5)];
  const result = reviewClipBatch([source], words, 20000);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].end_seconds > 6501.5);
});

test('a payoff that cannot fit without removing setup remains flagged and untrimmed', () => {
  const source = clip(100, 160, 125, { title: 'A long setup', reason: 'The answer after the question is the payoff.' });
  const words = [word('Setup', 100.2), word('starts.', 101), word('Why?', 158),
    word('Because', 162), word('it', 162.5), word('works!', 164)];
  const result = reviewClipBatch([source], words, 1000);
  assert.equal(result.ready.length, 0);
  assert.equal(result.flagged[0].clip.start_seconds, 100);
  assert.ok(flags(result).includes('duration_over_60s'));
});

test('an immediate spoken reaction after the punchline is retained when it fits', () => {
  const source = clip(100, 145, 140, { reason: 'The surprise reaction completes the moment.' });
  const words = [word('Setup.', 101), word('I', 142), word('won!', 143),
    word('Oh', 145.4), word('my', 145.6), word('God!', 146)];
  const result = reviewClipBatch([source], words, 1000);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].end_seconds > 146);
});

test('saved Opus taco cut reaches the best-toast line after removing only the opening preamble', () => {
  const source = clip(7555, 7618, 7587, {
    title: 'He got a TACO TRUCK and toast with his FACE on it',
    reason: 'Absurd props while they play make this entertaining.',
  });
  const words = [word('going?', 7555.9), word('Yo,', 7560.9), word('Twizz,', 7562),
    word('what?', 7563), word('They', 7568.5), word('bring', 7569), word('something.', 7570),
    word('Yo,', 7571.5), word('bro.', 7572), word('You', 7575), word('got', 7575.3),
    word('taco', 7576), word('truck!', 7577), word('Toast', 7586.5), word('face.', 7590),
    word('Wait,', 7618.4), word('let', 7618.7), word('me', 7618.9), word('try', 7619),
    word('it.', 7619.2), word('Hold', 7619.4), word('up.', 7620),
    word('bro,', 7622), word('best', 7622.6), word('toast', 7622.9), word('ever!', 7623.7)];
  const result = reviewClipBatch([source], words, 20000);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].start_seconds >= 7564);
  assert.ok(result.ready[0].end_seconds > 7623.7);
  assert.ok(result.ready[0].end_seconds - result.ready[0].start_seconds <= 60);
});

test('a completed punchline is not extended into an unrelated next question', () => {
  const source = clip(14380, 14430, 14420, { title: 'Cereal rehab', reason: 'His deadpan answer lands.' });
  const words = [word('Setup.', 14381), word('How?', 14426), word('Horrible.', 14429.7),
    word('Who', 14430.6), word('was', 14430.8), word('next?', 14431.8)];
  const result = reviewClipBatch([source], words, 20000);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].end_seconds <= 14430.5);
});

test('active speech without a nearby sentence end is flagged, not guessed into a clip', () => {
  const source = clip(100, 140, 120);
  const words = [word('Setup.', 101), word('This', 139.4), word('is', 139.8),
    word('still', 140.1), word('going', 140.4), word('and', 141), word('on', 141.5)];
  const result = reviewClipBatch([source], words, 1000);
  assert.equal(result.ready.length, 0);
  assert.ok(flags(result).includes('ends_mid_sentence'));
});

test('masked-entourage pilot stops after complete reaction before unrelated gameplay callout', () => {
  const source = clip(9680, 9722, 9715, {
    title: 'Masked entourage answer',
    reason: "A deadpan 'not unless we lose' answers a nervous question.",
  });
  const words = [
    word('Masked.', 9681), word('right?', 9712.6, 9712.8), word('No,', 9714.7, 9714.9),
    word('not', 9714.9, 9715.2), word('unless', 9715.9, 9716.2),
    word('we', 9716.2, 9716.3), word('lose.', 9716.3, 9716.6),
    word('Surprise,', 9718.6, 9719.2), word('motherfucker!', 9719.3, 9719.8),
    word('My', 9720.75, 9720.83), word('bad,', 9720.85, 9721.13),
    word("we're", 9721.24, 9721.39), word('going', 9721.47, 9721.74),
    word('to', 9721.74, 9721.78), word('win.', 9721.78, 9721.824),
    word('My', 9721.954, 9721.986), word('bad,', 9721.986, 9722.181),
    word('bro.', 9722.213, 9722.376), word('Get', 9722.441, 9722.538),
    word('in', 9722.538, 9722.57), word('front', 9722.57, 9722.765),
    word('of', 9722.765, 9722.927), word('you,', 9722.944, 9723.025),
    word('get', 9723.414, 9723.479), word('in', 9723.479, 9723.512),
    word('front', 9723.512, 9723.658), word('of', 9723.658, 9723.69),
    word('you,', 9723.69, 9723.771), word('get', 9723.82, 9723.934),
    word('in', 9723.934, 9723.999), word('front', 9723.999, 9724.161),
    word('of', 9724.161, 9725.112), word('you!', 9725.112, 9725.144),
    word('32,', 9725.208, 9725.659), word('dead.', 9726.175, 9726.416),
  ];
  const result = reviewClipBatch([source], words, 17831);
  assert.equal(result.ready.length, 1);
  assert.ok(result.ready[0].end_seconds >= 9722.376);
  assert.ok(result.ready[0].end_seconds < 9722.441);
  assert.ok(result.ready[0].end_seconds - result.ready[0].start_seconds <= 60);
});
