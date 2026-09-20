import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Date.now() is forbidden for deterministic generation."
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "new Date() is forbidden for deterministic generation."
        }
      ]
    }
  }
);
