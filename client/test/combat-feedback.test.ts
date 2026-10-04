import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatFeedback } from '../src/game/CombatFeedback';

test('rapid eliminations chain, expire, and reset on death', () => {
  const feedback = new CombatFeedback();
  assert.equal(feedback.eliminate(0), 'PLUCKED');
  assert.equal(feedback.eliminate(4500), 'DOUBLE PLUCK');
  assert.equal(feedback.eliminate(9001), 'PLUCKED');
  assert.equal(feedback.streak, 3);
  feedback.died();
  assert.equal(feedback.eliminate(9100), 'PLUCKED');
  assert.equal(feedback.streak, 1);
  assert.equal(feedback.bestStreak, 3);
  feedback.reset();
  assert.equal(feedback.bestStreak, 0);
});

test('confirmed pellets accumulate briefly without carrying old damage into the next burst', () => {
  const feedback = new CombatFeedback();
  assert.equal(feedback.hit(12.2, false, 0), 13);
  assert.equal(feedback.hit(20, true, 100), 33);
  assert.equal(feedback.headshot, true);
  assert.equal(feedback.hit(8, false, 600), 8);
  assert.equal(feedback.headshot, false);
  assert.equal(feedback.hit(NaN, false, 601), 8);
  assert.equal(feedback.hit(-10, false, 602), 8);
  feedback.died();
  assert.equal(feedback.hit(15, false, 603), 15);
});
