import type { AssistantTurn } from '@careflow/shared';
import { cn } from '../../lib/utils';

type ChatMessageRecord = AssistantTurn['messages'][number];

export function ChatMessage({
  message,
  timeZone,
}: {
  message: ChatMessageRecord;
  timeZone: string;
}) {
  const mine = message.senderKind === 'user';
  return (
    <article className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
        {mine ? 'You' : 'Assistant'}
      </p>
      <div
        className={cn(
          'w-full max-w-[min(100%,42rem)] min-w-0 rounded-lg px-4 py-3 text-base leading-7 break-words whitespace-pre-wrap',
          mine ? 'bg-teal-deep text-white' : 'border border-line bg-white text-ink',
        )}
      >
        {message.body}
      </div>
      <time className="text-xs text-ink-soft" dateTime={message.createdAt}>
        {formatStamp(message.createdAt, timeZone)}
      </time>
    </article>
  );
}

function formatStamp(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
