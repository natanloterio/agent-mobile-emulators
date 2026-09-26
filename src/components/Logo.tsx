interface LogoProps { readonly size?: number }

/** Estrela de 4 pontas do Positivus, em verde. */
export function Logo({ size = 28 }: LogoProps) {
  return (
    <svg viewBox="0 0 35.252 35.252" width={size} height={size} aria-hidden="true">
      <path
        d="M 17.651 5.186 L 35.252 0 L 30.116 17.651 L 35.252 35.252 L 17.651 30.116 L 0 35.252 L 5.186 17.651 L 0 0 L 17.651 5.186 Z"
        fill="#B9FF66"
      />
    </svg>
  );
}
