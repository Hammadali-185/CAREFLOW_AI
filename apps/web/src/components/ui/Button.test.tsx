import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('calls the click handler from the keyboard and pointer', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not submit a surrounding form unless asked', () => {
    render(
      <form>
        <Button>Save</Button>
      </form>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });
});
