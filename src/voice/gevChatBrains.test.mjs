import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZaiChatRequest,
  extractZaiChatAnswer,
  isValidZaiModel,
  resolveZaiModel,
  ZAI_DEFAULT_MODEL,
} from './gevZai.js';
import {
  buildOllamaChatRequest,
  extractOllamaChatAnswer,
  isValidOllamaModel,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_VISION_MODEL,
  resolveOllamaModel,
  resolveOllamaVisionModel,
} from './gevOllama.js';

test('zai defaults to glm-5.3-flash and gates model ids', () => {
  assert.equal(ZAI_DEFAULT_MODEL, 'glm-5.3-flash');
  assert.equal(isValidZaiModel('glm-5.3-flash'), true);
  assert.equal(isValidZaiModel('../evil'), false);
  assert.equal(isValidZaiModel('model name'), false);
  assert.equal(resolveZaiModel('../evil'), ZAI_DEFAULT_MODEL);
});

test('zai request is openai-shaped with grounded context', () => {
  const { model, body } = buildZaiChatRequest({ message: 'Hi', contextText: 'Austin' });
  assert.equal(model, ZAI_DEFAULT_MODEL);
  assert.equal(body.model, ZAI_DEFAULT_MODEL);
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[1].content.includes('Austin'));
  assert.equal(body.stream, undefined, 'non-streaming');
});

test('zai extractor reads choices, reports errors', () => {
  assert.deepEqual(
    extractZaiChatAnswer({ choices: [{ message: { content: ' Hallo. ' } }] }),
    { text: 'Hallo.', blocked: false },
  );
  const empty = extractZaiChatAnswer({ choices: [] });
  assert.equal(empty.blocked, true);
  const denied = extractZaiChatAnswer({ error: { message: 'invalid key', code: 401 } });
  assert.match(denied.reason, /invalid key/);
});

test('ollama defaults and gates model ids', () => {
  assert.equal(OLLAMA_DEFAULT_MODEL, 'gpt-oss:120b');
  assert.equal(isValidOllamaModel('gpt-oss:120b'), true);
  assert.equal(isValidOllamaModel('kimi-k2.6'), true);
  assert.equal(isValidOllamaModel('../evil'), false);
  assert.equal(resolveOllamaModel('no spaces here!'), OLLAMA_DEFAULT_MODEL);
});

test('ollama request is native-shaped, non-streaming', () => {
  const { model, body } = buildOllamaChatRequest({ message: 'Hi', contextText: 'Austin' });
  assert.equal(model, OLLAMA_DEFAULT_MODEL);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[1].content.includes('Austin'));
});

test('ollama extractor reads message.content, reports errors', () => {
  assert.deepEqual(
    extractOllamaChatAnswer({ message: { content: ' Servus. ' } }),
    { text: 'Servus.', blocked: false },
  );
  const empty = extractOllamaChatAnswer({});
  assert.equal(empty.blocked, true);
  const denied = extractOllamaChatAnswer({ error: 'unauthorized' });
  assert.match(denied.reason, /unauthorized/);
});

test('ollama vision calls ride the vision model with cleaned images', () => {
  assert.equal(OLLAMA_DEFAULT_VISION_MODEL, 'gemma4:31b');
  assert.equal(resolveOllamaVisionModel('../evil'), 'gemma4:31b');
  const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
  const { model, body } = buildOllamaChatRequest({
    message: 'hi',
    images: ['data:image/jpeg;base64,AAA=', 'not-base64!!!', 'data:image/png;base64,BBB='],
  });
  assert.equal(model, 'gemma4:31b');
  assert.deepEqual(body.messages[1].images, ['AAA=', 'BBB=']);
  const text = buildOllamaChatRequest({ message: 'hi' });
  assert.equal(text.model, OLLAMA_DEFAULT_MODEL);
  assert.equal(text.body.messages[1].images, undefined);
});
