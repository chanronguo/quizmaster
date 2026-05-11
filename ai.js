// AI-powered quiz question generator.
// Supports three providers: "anthropic", "openai", and "mock".
// Returns an array of: { question, options: [4 strings], correctIndex: 0..3 }

const PROVIDER = (process.env.AI_PROVIDER || 'mock').toLowerCase();

const SYSTEM_PROMPT = `You are an expert quiz writer for a live multiplayer trivia game.

CORE RULES — every question must satisfy ALL of these:

1. SPECIFIC & FACT-CHECKABLE
   - Ask about a concrete fact (year, name, number, event, definition, location, etc.)
   - The answer must be verifiable in a reference source.
   - BAD: "What is the most important feature of X?" (subjective)
   - GOOD: "In which year was X released?" (one objective answer)

2. EXACTLY ONE UNAMBIGUOUSLY CORRECT ANSWER
   - Reasonable, knowledgeable people must all agree on the same answer.
   - The 4 options must be MUTUALLY EXCLUSIVE — no overlap.
   - BAD: options "1950s", "1955", "Mid-20th century", "1960" — 3 of these overlap.
   - GOOD: options "1953", "1965", "1972", "1989" — clearly distinct.
   - If the question is hard, it should be hard because the FACT is obscure, not because the wording is fuzzy.

3. 3 PLAUSIBLE BUT VERIFIABLY WRONG DISTRACTORS
   - Wrong options should look like they could be right to someone who half-knows the topic.
   - But each must be objectively wrong, with no defensible argument that it's also correct.

4. RELEVANT & INTERESTING
   - The question must teach or reveal something about the specific topic.
   - Don't write generic filler ("Which of these is most associated with X?").
   - Don't write meta-questions about whether something is famous or has a Wikipedia page.

5. VARIETY OF QUESTION FORMS
   - Mix: who/what/when/where/how-many, fill-in-the-blank, "which of these is NOT...", numeric answers.
   - Don't make every question start the same way.

THINGS TO AVOID — never write questions like these:
- "X is best known for ___?" (subjective, multiple defensible answers)
- "Which of these is most associated with X?" (vague)
- "Is X popular?" (opinion)
- "How would you describe X?" (subjective)
- Questions where the answer depends on context not given.
- Trick questions or "gotchas".

OUTPUT FORMAT
- Return ONLY valid JSON.
- No prose, no markdown code fences, no explanations.
- Match the user's requested language: if the topic or instructions are in Chinese, write the questions in Chinese.`;

function userPrompt({ topic, count, difficulty }) {
  const difficultyGuide = {
    easy: 'EASY: well-known basics a casual fan or general audience would know.',
    medium: 'MEDIUM: requires real interest in the topic; not on the first page of Wikipedia.',
    hard: 'HARD: deep knowledge — specific dates, niche names, lesser-known facts. Still UNAMBIGUOUS — hard ≠ debatable.',
  }[difficulty] || 'MEDIUM difficulty.';

  return `Write ${count} multiple-choice quiz questions about the topic: "${topic}".

Difficulty: ${difficultyGuide}

Requirements per question:
- Exactly 4 answer options.
- Exactly ONE option is unambiguously correct. No option should be "also correct".
- Options must be MUTUALLY EXCLUSIVE (no overlap in meaning, range, or category).
- The 3 wrong options must be plausible-looking but clearly, factually wrong.
- The question must be specific and about ${topic} (not generic).
- Do NOT include letter labels like "A)" / "B)" inside the option strings.
- Mix which position is correct across the ${count} questions (don't always put it first).
- If the topic is in Chinese, write the questions and options in Chinese.

Return JSON in EXACTLY this shape (no extra fields, no markdown):
{
  "questions": [
    {
      "question": "specific question about ${topic}",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correctIndex": 0
    }
  ]
}

"correctIndex" is an integer 0-3 indicating which option is correct.`;
}

// ---------- Mock provider (no API key required) ----------
function mockQuestions({ topic, count }) {
  const bank = [
    {
      question: `Which of these is most associated with ${topic}?`,
      options: ['The Apollo program', 'The printing press', 'The Renaissance', 'The Cold War'],
      correctIndex: 2,
    },
    {
      question: `True or false: ${topic} has a Wikipedia page.`,
      options: ['Definitely true', 'Probably true', 'Probably false', 'Definitely false'],
      correctIndex: 0,
    },
    {
      question: `If you had to summarize ${topic} in one word, which fits best?`,
      options: ['Fascinating', 'Tedious', 'Forgotten', 'Imaginary'],
      correctIndex: 0,
    },
    {
      question: `Which century saw the biggest developments in ${topic}?`,
      options: ['15th century', '18th century', '20th century', '21st century'],
      correctIndex: 2,
    },
    {
      question: `A friend asks you about ${topic}. What is the safest first answer?`,
      options: ['Let me look that up', 'It is overrated', 'I invented it', 'It does not exist'],
      correctIndex: 0,
    },
    {
      question: `Pick the most plausible fact about ${topic}:`,
      options: [
        'It is studied in universities',
        'It was outlawed worldwide in 1923',
        'It only exists on Mars',
        'It was invented yesterday',
      ],
      correctIndex: 0,
    },
    {
      question: `Which discipline most often studies ${topic}?`,
      options: ['History or science', 'Astrology', 'Origami', 'Competitive eating'],
      correctIndex: 0,
    },
    {
      question: `Which of these is NOT typically related to ${topic}?`,
      options: ['Books', 'Research', 'Time travel paradoxes', 'Conversations'],
      correctIndex: 2,
    },
  ];
  // Repeat / slice to reach `count`
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
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(opts) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  return parseQuestionJson(text);
}

// ---------- DeepSeek (OpenAI-compatible API) ----------
async function deepseekQuestions(opts) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(opts) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseQuestionJson(text);
}

// ---------- OpenAI ----------
async function openaiQuestions(opts) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(opts) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return parseQuestionJson(text);
}

function parseQuestionJson(text) {
  // Strip code fences if the model added them anyway.
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find the first {...} block.
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
    // Ensure we always return exactly `count`
    return questions.slice(0, count);
  } catch (err) {
    console.error('[ai] generation failed, falling back to mock:', err.message);
    return mockQuestions({ topic, count });
  }
}

module.exports = { generateQuestions, PROVIDER };
