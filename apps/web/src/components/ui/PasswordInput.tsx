import { useId, useState, type ComponentProps } from 'react';
import { Input } from './Input';

export function PasswordInput({ id, ...props }: ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="grid gap-2">
      <Input {...props} id={inputId} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="focus-ring justify-self-start rounded-sm text-sm font-semibold text-teal-deep"
        aria-controls={inputId}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Hide password' : 'Show password'}
      </button>
    </div>
  );
}
