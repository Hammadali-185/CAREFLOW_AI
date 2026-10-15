const emergencyPattern =
  /\b(chest pain|can'?t breathe|cannot breathe|trouble breathing|shortness of breath|stroke|suicidal|kill myself|severe bleeding|unconscious|heart attack|anaphylaxis|overdose|call 911|emergency)\b/i;

export const EMERGENCY_REPLY =
  'If this may be an emergency, call your local emergency number or go to the nearest emergency department. This assistant only helps with scheduling and cannot assess symptoms or give a medical diagnosis.';

export function looksLikeEmergency(text: string) {
  return emergencyPattern.test(text);
}
