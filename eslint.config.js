import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    extends: [tseslint.configs.base],
    plugins: {
      i18next,
    },
    rules: {
      'i18next/no-literal-string': ['error', {
        markupOnly: true,
        ignoreAttribute: [
          'className', 'style', 'type', 'id', 'name', 'key',
          'src', 'href', 'alt', 'title', 'aria-label',
          'data-type', 'data-cover', 'data-secret',
          'size', 'variant', 'value',
          'strokeLinecap', 'strokeLinejoin', 'strokeWidth',
          'fill', 'viewBox', 'stroke', 'd',
          'accept',
        ],
        ignoreText: ['-', '+', '×', '·', '/', '|', '...', ':'],
      }],
    },
  },
);
