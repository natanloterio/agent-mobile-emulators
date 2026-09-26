import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly grow?: boolean;
  readonly children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', grow = false, className = '', ...rest }: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, size !== 'md' ? `btn--${size}` : '', grow ? 'btn--grow' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" className={classes} {...rest} />;
}
