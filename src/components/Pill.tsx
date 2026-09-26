import type { ReactNode } from 'react';
import type { Tone } from '../state/selectors';

interface PillProps {
  readonly tone: Tone;
  readonly greenBorder?: boolean;
  readonly size?: 'sm' | 'md';
  readonly children: ReactNode;
}

export function Pill({ tone, greenBorder = false, size = 'sm', children }: PillProps) {
  const classes = ['pill', `pill--${tone}`, greenBorder ? 'pill--green-border' : '', size === 'md' ? 'pill--md' : '']
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{children}</span>;
}
