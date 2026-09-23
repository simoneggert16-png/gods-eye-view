import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTER_SYSTEM_PROMPT, ROUTER_VISION_ADDENDUM } from './gevChatRouter.js';
import { buildOllamaChatRequest, CHAT_SYSTEM_PROMPT_MAX_CHARS } from './gevOllama.js';
import { buildZaiChatRequest } from './gevZai.js';

test('chat brains receive the complete router and vision system prompt', () => {
  const system = `${ROUTER_SYSTEM_PROMPT}\n${ROUTER_VISION_ADDENDUM}`;
  assert.ok(system.length > 2000, 'this regression must cover the old truncation point');
  assert.ok(system.length <= CHAT_SYSTEM_PROMPT_MAX_CHARS, 'raise the shared budget when the router prompt grows');

  const ollama = buildOllamaChatRequest({ message: 'route this', system });
  assert.equal(ollama.body.messages[0].role, 'system');
  assert.equal(ollama.body.messages[0].content, system);

  const zai = buildZaiChatRequest({ message: 'route this', system });
  assert.equal(zai.body.messages[0].role, 'system');
  assert.equal(zai.body.messages[0].content, system);
});

test('chat system prompts are bounded by the shared budget', () => {
  const oversized = 'x'.repeat(CHAT_SYSTEM_PROMPT_MAX_CHARS + 100);
  const ollama = buildOllamaChatRequest({ message: 'route this', system: oversized });
  const zai = buildZaiChatRequest({ message: 'route this', system: oversized });
  assert.equal(ollama.body.messages[0].content.length, CHAT_SYSTEM_PROMPT_MAX_CHARS);
  assert.equal(zai.body.messages[0].content.length, CHAT_SYSTEM_PROMPT_MAX_CHARS);
});
