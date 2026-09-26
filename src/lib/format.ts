/** Formata número com vírgula decimal (pt-BR), sem separador de milhar. */
export function ptDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

export function usd(value: number): string {
  return `US$ ${ptDecimal(value, 2)}`;
}

export function pct(value: number): string {
  return `${Math.round(value)}%`;
}
