import type { ReactNode } from 'react';

interface NoticeProps { readonly tone?: 'error' | 'warn'; readonly children: ReactNode }

/** Erro (ou aviso) de uma chamada ao daemon, sempre visível onde a ação foi feita. */
export function Notice({ tone = 'error', children }: NoticeProps) {
  return (
    <div className={`notice${tone === 'warn' ? ' notice--warn' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
