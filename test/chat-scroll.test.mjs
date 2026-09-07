import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAnimateChatScroll } from '../src/chat-scroll.mjs';

test('chat scroll jumps immediately when an existing conversation is loaded', () => {
  const loaded = [{ id: 'a' }, { id: 'b' }];
  assert.equal(shouldAnimateChatScroll([], loaded), false);
  assert.equal(shouldAnimateChatScroll([{ id: 'old-a' }, { id: 'old-b' }], loaded), false);
});

test('chat scroll keeps following appended messages with animation', () => {
  const first = { id: 'a' };
  const second = { id: 'b' };
  const third = { id: 'c' };
  assert.equal(shouldAnimateChatScroll([first, second], [first, second, third]), true);
  assert.equal(shouldAnimateChatScroll([first, second], [first]), false);
});
