import type { ReactNode } from 'react';

interface HeadingProps {
  readonly size?: 'h2' | 'h3' | 'h4';
  readonly variant?: 'green' | 'white' | 'black';
  readonly children: ReactNode;
}

/** Heading Positivus: texto sobre um pill de cor sólida, uma linha. */
export function Heading({ size = 'h2', variant = 'green', children }: HeadingProps) {
  const Tag = size;
  return <Tag className={`heading heading--${size} heading--${variant}`}>{children}</Tag>;
}
