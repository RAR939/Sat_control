// src/utils/pluralize.ts
//
// Русское склонение существительного после числительного
// (1 переход, 2 перехода, 5 переходов, 21 переход...).

export function pluralize(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
