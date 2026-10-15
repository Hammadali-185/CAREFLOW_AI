import { Button } from '../../components/ui/Button';

export function SuggestedReplies({
  suggestions,
  disabled,
  onSelect,
}: {
  suggestions: string[];
  disabled: boolean;
  onSelect: (suggestion: string) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2" aria-label="Suggested replies">
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          variant="secondary"
          disabled={disabled}
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
