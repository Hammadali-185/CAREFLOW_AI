const greetingPattern =
  /^(?:(?:hi|hello|hey|hiya)(?: there)?|good morning|good afternoon|good evening)(?: how are you(?: doing)?)?$|^(?:how are you(?: doing)?|thanks|thank you)$/;

export function looksLikeGreeting(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return greetingPattern.test(normalized);
}

export function greetingReply(clinicName: string) {
  return `Hello. I can schedule a visit at ${clinicName}. Tell me the kind of visit and a day, such as a follow-up next Thursday morning. I can also list, move, or cancel a visit you already booked.`;
}
