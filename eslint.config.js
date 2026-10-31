import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Determinism guard for the simulation (CLAUDE.md, TDD §4).
const nonDeterministic = [
  { object: 'Math', property: 'random', message: 'Use the seeded RNG from sim/rng.ts.' },
  { object: 'Date', property: 'now', message: 'No wall-clock time in sim.' },
  { object: 'performance', property: 'now', message: 'No wall-clock time in sim.' },
];
const rawTrig = ['sin', 'cos', 'tan', 'atan2', 'asin', 'acos', 'atan'].map((property) => ({
  object: 'Math',
  property,
  message: 'Use sim/math.ts so trig can be swapped for table-based versions.',
}));

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'Date',
        'performance',
        'setTimeout',
        'setInterval',
        'requestAnimationFrame',
        'window',
        'document',
      ],
      'no-restricted-properties': ['error', ...nonDeterministic, ...rawTrig],
    },
  },
  {
    files: ['src/sim/math.ts'],
    rules: { 'no-restricted-properties': ['error', ...nonDeterministic] },
  },
);
