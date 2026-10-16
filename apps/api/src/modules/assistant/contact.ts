import type { WorkflowState } from '@careflow/shared';
import { contactMissing } from './workflow.js';

const phonePattern = /(?:\+?\d[\d\s().-]{6,}\d)/;
const namedPattern =
  /(?:(?:my name is|i am|i'm|name(?:\s+is)?|this is)\s+)([A-Za-z][A-Za-z .'-]{0,80})/i;

export function absorbContactFromText(state: WorkflowState, text: string): WorkflowState {
  const asking =
    state.missingFields.includes('name') ||
    state.missingFields.includes('phone') ||
    (state.selectedSlot !== null && state.intent === 'book');
  if (!asking) {
    return state;
  }
  const missing = contactMissing(state);
  if (missing.length === 0) {
    return state;
  }
  let contactName = state.contactName;
  let contactPhone = state.contactPhone;
  const phone = phonePattern.exec(text);
  if (missing.includes('phone') && phone?.[0]) {
    contactPhone = phone[0].replace(/\s+/g, ' ').trim().slice(0, 32);
  }
  const named = namedPattern.exec(text);
  if (missing.includes('name') && named?.[1]) {
    contactName = named[1].trim().replace(/[.,]+$/, '').slice(0, 120);
  } else if (missing.includes('name') && !contactName) {
    const withoutPhone = phone?.[0]
      ? text.replace(phone[0], ' ').replace(/[,\s]+/g, ' ').trim()
      : text.trim();
    if (
      withoutPhone.length >= 2 &&
      withoutPhone.length <= 120 &&
      withoutPhone.split(/\s+/).length <= 5 &&
      !/\d/.test(withoutPhone) &&
      !/^(yes|no|ok|okay|tomorrow|today|hi|hello)\b/i.test(withoutPhone)
    ) {
      contactName = withoutPhone.slice(0, 120);
    }
  }
  if (contactName === state.contactName && contactPhone === state.contactPhone) {
    return state;
  }
  return { ...state, contactName, contactPhone };
}
