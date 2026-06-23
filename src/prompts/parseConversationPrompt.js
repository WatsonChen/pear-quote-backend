/**
 * Builds the prompt for POST /api/ai/parse-conversation.
 *
 * @param {object} params
 * @param {string} params.rawInput  - Raw user-pasted text (LINE chat, email, etc.)
 * @returns {string}
 */
export function buildParseConversationPrompt({ rawInput }) {
  return `
You are an expert software project analyst. The user has pasted raw conversation text — it may be a LINE chat log, WhatsApp thread, email chain, meeting notes, or a mix of all of the above.

Your job is to read this raw input and extract a structured requirement specification (RequirementSpec) from it.

Return ONLY a valid JSON object matching the schema below. Do NOT include markdown fences, explanation, or any text outside the JSON.

SCHEMA:
{
  "rawInputType": "conversation | email | meeting_notes | short_brief | mixed",
  "detectedLanguage": "zh-TW | en | mixed",
  "conversationSummary": "string (1-3 sentences summarising what this conversation is about)",
  "detectedSpeakers": [
    {
      "label": "string (e.g. '客戶窗口', '業務', '王先生')",
      "role": "client | sales | developer | decision_maker | unknown"
    }
  ],
  "clientIntent": "string (what does the client ultimately want to achieve?)",
  "projectType": "string (e.g. '電商網站', 'Line Bot', '行動應用程式', '後台管理系統')",
  "businessGoal": "string (the underlying business objective, not just the feature list)",
  "targetUsers": ["string"],
  "platforms": ["string (e.g. 'Web', 'iOS', 'Android', 'LINE', 'WeChat')"],
  "requirements": [
    {
      "id": "string (e.g. R1, R2)",
      "text": "string (one clear requirement, in Traditional Chinese)",
      "status": "confirmed | inferred | conflicting",
      "evidence": "string (verbatim excerpt from the input that supports this requirement; 'AI 推測' if inferred with no direct evidence)",
      "confidence": 0.0
    }
  ],
  "missingQuestions": [
    {
      "question": "string (繁體中文, specific question)",
      "whyItMatters": "string (concrete impact on scope or price)",
      "priceImpact": "high | medium | low"
    }
  ],
  "assumptions": ["string (繁體中文)"],
  "exclusions": ["string (繁體中文, things clearly out of scope or not mentioned)"],
  "risks": [
    {
      "risk": "string (繁體中文)",
      "mitigation": "string (繁體中文)"
    }
  ]
}

RULES:
1. **Language**: Write all text fields in Traditional Chinese (繁體中文) regardless of the input language. Only "rawInputType", "detectedLanguage", "status", "role", and "priceImpact" use the English enum values.

2. **rawInputType detection**:
   - "conversation": LINE/WhatsApp-style chat (short messages, timestamps, names)
   - "email": email threads (formal, has subject/greetings)
   - "meeting_notes": bullet-point or paragraph notes from a meeting
   - "short_brief": a single paragraph or bullet list of requirements
   - "mixed": cannot clearly identify one type

3. **detectedSpeakers**: Identify speakers from names, labels (e.g. "[王大明]", "客戶:", "業務:").
   - If you cannot identify any speaker, return one entry: { "label": "未知", "role": "unknown" }
   - Do NOT guess roles without evidence. Use "unknown" when unsure.

4. **requirements status**:
   - "confirmed": explicitly stated in the input (can be directly quoted)
   - "inferred": logically implied but not directly stated
   - "conflicting": contradicted by another part of the conversation
   - Every "confirmed" requirement MUST have verbatim evidence from the input.
   - Every "inferred" requirement MUST have evidence set to "AI 推測".

5. **evidence**: Must be a verbatim excerpt (direct quote) from the input. Do NOT paraphrase. If multiple sentences support it, join with " / ".

6. **missingQuestions**: Only include questions where the answer would significantly change the quote or scope. Do NOT ask about things already mentioned.
   - Examples: 是否需要會員系統？是否需要金流串接？是否需要後台管理？是否需要 RWD？

7. **assumptions**: State what you assumed to be true in order to interpret the requirements (e.g. "假設使用繁體中文介面" "假設不含金流串接").

8. **exclusions**: Things clearly out of scope based on the conversation (e.g. "客戶明確表示不需要 App").

9. **risks**: 2–4 project-specific risks inferred from the conversation context.

RAW INPUT:
${rawInput || "(no input provided)"}
`;
}
