interface LogoProps { readonly size?: number }

/** Ícone do TapFlock (design/brand/tapflock-icon.svg): símbolo lima e branco no quadrado escuro, com borda sutil. */
export function Logo({ size = 28 }: LogoProps) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="8" y="8" width="1008" height="1008" rx="232" fill="#191A23" stroke="rgba(243, 243, 243, 0.18)" strokeWidth="16" />
      <path
        fill="#B9FF66"
        d="M120 232 H735 C803 232 858 290 892 366 H852 C760 366 688 444 688 540 V762 C688 816 644 858 592 858 H566 C553 858 543 848 543 835 V470 C543 425 507 388 462 388 H300 C205 388 132 328 112 252 C110 241 112 232 120 232 Z"
      />
      <circle cx="747" cy="313" r="32" fill="#191A23" />
      <path fill="#F3F3F3" d="M139 400 C200 420 262 437 330 437 H440 C466 437 487 458 487 484 V546 C487 550 484 553 480 553 H292 C215 553 153 497 129 419 C126 407 130 397 139 400 Z" />
    </svg>
  );
}
