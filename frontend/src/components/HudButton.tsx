// src/components/HudButton.tsx
//
// Кнопка в стиле пульта управления (срезанные углы через clip-path,
// разреженный верхний регистр) — сознательно НЕ типовой rounded-gradient-pill,
// чтобы интерфейс не читался как шаблонный "AI-сайт".

import type { ButtonHTMLAttributes } from 'react';

type HudButtonVariant = 'primary' | 'ghost' | 'danger';

interface HudButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: HudButtonVariant;
}

const CLIP =
  'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)';

const VARIANT_CLASSES: Record<HudButtonVariant, string> = {
  primary: 'bg-sky-400 text-slate-950 hover:bg-sky-300 shadow-[0_0_18px_-4px_rgba(56,189,248,0.7)]',
  ghost:
    'border border-sky-500/40 bg-sky-500/5 text-sky-300 hover:border-sky-300 hover:bg-sky-500/10 hover:text-white',
  danger:
    'border border-rose-500/40 bg-rose-500/5 text-rose-300 hover:border-rose-300 hover:bg-rose-500/10 hover:text-white',
};

export function HudButton({
  variant = 'primary',
  className = '',
  children,
  ...props
}: HudButtonProps) {
  return (
    <button
      {...props}
      style={{ clipPath: CLIP }}
      className={`px-4 py-2 text-xs font-semibold tracking-[0.14em] uppercase transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
