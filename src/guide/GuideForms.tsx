import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { FormValues } from './actions';
import type { GuideForm } from './script';

interface FieldSpec { readonly name: string; readonly label: MessageKey; readonly type: 'email' | 'password' | 'text'; readonly placeholder?: string }

const FIELDS: Readonly<Record<GuideForm, readonly FieldSpec[]>> = {
  google: [{ name: 'email', label: 'guide.form.email', type: 'email', placeholder: 'voce@gmail.com' }, { name: 'password', label: 'guide.form.password', type: 'password' }],
  handle: [{ name: 'handle', label: 'guide.form.handle', type: 'text', placeholder: '@nuvem.cafe' }],
  pin: [{ name: 'pin', label: 'guide.form.pin', type: 'password' }],
  credentials: [{ name: 'username', label: 'guide.form.username', type: 'text', placeholder: 'nuvem.cafe' }, { name: 'password', label: 'guide.form.password', type: 'password' }],
};

/**
 * Formulário de um cartão do Guia. As senhas ficam só no estado deste componente até a ponte do cofre;
 * são apagadas depois do envio, dê certo ou não (spec guia §1.2).
 */
export function GuideFormCard({ form, busy, onSubmit, children }: {
  readonly form: GuideForm; readonly busy: boolean;
  readonly onSubmit: (form: GuideForm, values: FormValues) => Promise<boolean>;
  readonly children?: ReactNode;
}) {
  const { t } = useI18n();
  const fields = FIELDS[form];
  const [values, setValues] = useState<Record<string, string>>({});
  // O PIN não vai para o cofre: o daemon o guarda para destravar o celular sozinho depois de um reinício.
  const note: MessageKey | null = form === 'pin' ? 'guide.form.pinNote' : fields.some((f) => f.type === 'password') ? 'guide.form.lock' : null;
  const filled = fields.every((f) => (values[f.name] ?? '').trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await onSubmit(form, values);
    setValues((v) => {
      const next = { ...v };
      for (const f of fields) if (f.type === 'password' || ok) delete next[f.name];
      return next;
    });
  };
  return (
    <form className="guide-form" onSubmit={(e) => void submit(e)}>
      {fields.map((f) => (
        <label key={f.name} className="guide-form__field">
          {t(f.label)}
          <input
            className="guide-form__input" type={f.type} autoComplete="off" spellCheck={false} placeholder={f.placeholder}
            inputMode={form === 'pin' ? 'numeric' : undefined}
            value={values[f.name] ?? ''} disabled={busy}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      {note && <p className="guide-form__lock"><span aria-hidden="true">🔒</span>{t(note)}</p>}
      <div className="guide-card__actions">
        <Button type="submit" size="sm" disabled={busy || !filled}>{t(busy ? 'guide.busy' : 'guide.form.save')}</Button>
        {children}
      </div>
    </form>
  );
}
