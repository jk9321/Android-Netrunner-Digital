import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // `a || b()` and `ok ? x() : y()` as statements are used on purpose in the engine
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // `let [s, id] = ...` where only `s` is reassigned is fine
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    // React code only: the engine has functions named use... (useAbility, useOncePerTurn) that aren't hooks
    files: ['src/App.tsx', 'src/main.tsx', 'src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
