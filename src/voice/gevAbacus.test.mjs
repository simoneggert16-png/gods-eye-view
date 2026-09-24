import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ABACUS_DEFAULT_MODEL,
  buildAbacusChatRequest,
  extractAbacusChatAnswer,
  isValidAbacusModel,
  resolveAbacusModel,
} from './gevAbacus.js';

test('validates and resolves Abacus model names safely', () => {
  assert.equal(isValidAbacusModel('gpt-4o-mini'), true);
  assert.equal(isValidAbacusModel('claude-3-5-sonnet'), true);
  assert.equal(isValidAbacusModel('meta/llama-3.3-70b'), true);
  assert.equal(isValidAbacusModel('deepseek-ai/DeepSeek-V4.1-Flash'), true);
  assert.equal(isValidAbacusModel('../bad/path'), false);
  assert.equal(isValidAbacusModel(''), false);

  assert.equal(resolveAbacusModel('gpt-4o'), 'gpt-4o');
  assert.equal(resolveAbacusModel('deepseek'), 'deepseek-ai/DeepSeek-V4.1-Flash');
  assert.equal(resolveAbacusModel('deepseek-v4.1-flash'), 'deepseek-ai/DeepSeek-V4.1-Flash');
  assert.equal(resolveAbacusModel('   '), ABACUS_DEFAULT_MODEL);
  assert.equal(resolveAbacusModel(null), ABACUS_DEFAULT_MODEL);
});

test('builds OpenAI-compatible chat request with scene context and vision images', () => {
  const req = buildAbacusChatRequest({
    message: 'Was siehst du in Zürich?',
    contextText: 'Bürkliplatz Zürich, heading 150',
    model: 'gpt-4o-mini',
    images: ['data:image/jpeg;base64,QUJDREVGMTIz'],
  });

  assert.equal(req.model, 'gpt-4o-mini');
  assert.equal(req.body.model, 'gpt-4o-mini');
  assert.equal(req.body.messages.length, 2);
  assert.equal(req.body.messages[0].role, 'system');
  assert.equal(req.body.messages[1].role, 'user');
  assert.ok(Array.isArray(req.body.messages[1].content));
  assert.ok(req.body.messages[1].content[0].text.includes('Bürkliplatz Zürich'));
  assert.equal(req.body.messages[1].content[1].type, 'image_url');
});

test('extracts text from standard OpenAI-compatible response and strips <think> tags', () => {
  const result = extractAbacusChatAnswer({
    choices: [
      { message: { content: '<think>User wants to know the view.</think>Sicht auf den Zürichsee ist klar.' } },
    ],
  });
  assert.equal(result.blocked, false);
  assert.equal(result.text, 'Sicht auf den Zürichsee ist klar.');

  const reasoningResult = extractAbacusChatAnswer({
    choices: [
      { message: { reasoning_content: 'Nur Gedankengang.' } },
    ],
  });
  assert.equal(reasoningResult.blocked, false);
  assert.equal(reasoningResult.text, 'Nur Gedankengang.');

  const empty = extractAbacusChatAnswer({});
  assert.equal(empty.blocked, true);
  assert.equal(empty.text, null);
});
