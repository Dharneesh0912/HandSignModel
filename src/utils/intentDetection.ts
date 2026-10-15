export interface DocumentIntent { isIntent: boolean; confidence: number; }

export function detectDocumentIntent(text: string): DocumentIntent {
  const high = [
    /submit\s*(a)?\s*document/i, /upload\s*(a)?\s*document/i,
    /document\s*processing/i, /process\s*(my)?\s*document/i,
    /i want to submit/i, /i need to upload/i,
    /^submit$/i, /^upload$/i,
  ];
  const medium = [
    /employee\s*(id|identification)/i, /passport/i, /visa/i,
    /certification/i, /credential/i, /contract/i, /onboarding document/i,
  ];
  const low = [/document/i, /file/i, /attachment/i, /form/i];

  let confidence = 0;
  for (const p of high) if (p.test(text)) confidence += 0.8;
  for (const p of medium) if (p.test(text)) confidence += 0.4;
  for (const p of low) if (p.test(text)) confidence += 0.2;
  return { isIntent: confidence >= 0.5, confidence: Math.min(confidence, 1.0) };
}

export function getCancelPhrases(): string[] {
  return ['cancel', 'never mind', 'stop', 'exit', 'abort', 'back', 'go back'];
}