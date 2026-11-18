import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // design/ holds local, git-ignored prototypes.
  { ignores: ['**/dist/**', '**/node_modules/**', '**/test/fixtures/**', 'design/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // With noUncheckedIndexedAccess, `!` after a bounds-checked index is the honest way to say "present".
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
