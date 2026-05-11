// AI-powered quiz question generator.
// Supports four providers: "anthropic", "openai", "deepseek", and "mock".

const PROVIDER = (process.env.AI_PROVIDER || 'mock').toLowerCase();

const SYSTEM_PROMPT = `You are a fun, fair quiz writer. Generate multiple-choice trivia questions.
Each question must have exactly 4 answer options, exactly one of which is correct.
Questions should be clear, factually accurate, and approachable. Avoid trick questions.
Return ONLY valid JSON, no prose, no markdown fencing.`;

function userPrompt({ topic, count, difficulty }) {
  return `Write ${count} multiple-choice quiz questions about: ${topic}.
Difficulty: ${difficulty}.
Return JSON in EXACTLY this shape:
{
  "questions": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0
    }
  ]
}
The "correctIndex" must be an integer 0-3 indicating which option is correct.
Mix up which position is correct across questions.`;
}

// ---------- Mock provider (no API key required) ----------
function mockQuestions({ topic, count }) {
  const bank = [
    { question: `Which of these is most associated with ${topic}?`, options: ['The Apollo program', 'The printing press', 'The Renaissance', 'The Cold War'], correctIndex: 2 },
    { question: `True or false: ${topic} has a Wikipedia page.`, options: ['Definitely true', 'Probably true', 'Probably false', 'Definitely false'], correctIndex: 0 },
    { question: `If you had to summarize ${topic} in one word, which fits best?`, options: ['Fascinating', 'Tedious', 'Forgotten', 'Imaginary'], correctIndex: 0 },
    { question: `Which century saw the biggest developments in ${topic}?`, options: ['15th century', '18th century', '20th century', '21st century'], correctIndex: 2 },
    { question: `A friend asks you about ${topic}. What is the safest first answer?`, options: ['Let me look that up', 'It is overrated', 'I invented it', 'It does not exist'], correctIndex: 0 } ,
    { question: `Pick the most plausible fact about ${topic}:`, options: ['It is studied in universities', 'It was outlawed worldwide in 1923', 'It only exists on Mars', 'It was invented yesterday'], correctIndex: 0 },
    { question: `Which discipline most often studies ${topic}?`, options: ['History or science', 'Astrology', 'Origami', 'Competitive eating'], correctIndex: 0 },
    { question: `Which of these is NOT typically related to ${topic}?`, options: ['Books', 'Research', 'Time travel paradoxes', 'Conversations'], correctIndex: 2 },
  ];
  const out = [];
  for (let i = 0; i < count; i++) out.push(bank[i % bank.length]);
  return out;
}

// ---------- Anthropic (Claude) ----------
async function anthropicQuestions(opts) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5', max_tokens: 2048, system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(opts) }],
    }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${text}`); }
  const data = await res.json();
  return parseQuestionJson(data?.content?.[0]?.text || '');
}

// ---------- DeepSeek ----------
async function deepseekQuestions(opts) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(opts) },
      ],
    }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`DeepSeek API error ${res.status}: ${text}`); }
  const data = await res.json();
  return parseQuestionJson(data?.choices?.[0]?.message?.content || '');
}

// ---------- OpenAI ----------
async function openaiQuestions(opts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(opts) },
      ],
    }),
  });
  if (!res.ok) { const text = await res.text(); throw new Error(`OpenAI API error ${res.status}: ${text}`); }
  const data = await res.json();
  return parseQuestionJson(data?.choices?.[0]?.message?.content || '');
}

function parseQuestionJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI did not return JSON');
    parsed = JSON.parse(match[0]);
  }
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return questions
    .map((q) => ({
      question: String(q.question || '').trim(),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map((o) => String(o)) : [],
      correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : 0,
    }))
    .filter((q) => q.question && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex < 4);
}

async function generateQuestions({ topic, count = 5, difficulty = 'medium' }) {
  topic = String(topic || 'general knowledge').slice(0, 200);
  count = Math.max(1, Math.min(20, Number(count) || 5));
  difficulty = ['easy', 'medium', 'hard'].includes(String(difficulty).toLowerCase())
    ? String(difficulty).toLowerCase()
    : 'medium';

  try {
    let questions;
    if (PROVIDER === 'anthropic') questions = await anthropicQuestions({ topic, count, difficulty });
    else if (PROVIDER === 'openai') questions = await openaiQuestions({ topic, count, difficulty });
    else if (PROVIDER === 'deepseek') questions = await deepseekQuestions({ topic, count, difficulty });
    else questions = mockQuestions({ topic, count });

    if (!questions || questions.length === 0) {
      console.warn('[ai] provider returned no questions, falling back to mock');
      questions = mockQuestions({ topic, count });
    }
    return questions.slice(0, count);
  } catch (err) {
    console.error('[ai] generation failed, falling back to mock:', err.message);
    return mockQuestions({ topic, count });
  }
}

module.exports = { generateQuestions, PROVIDER };
