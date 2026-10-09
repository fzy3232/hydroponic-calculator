/**
 * ESLint 配置（flat config，ESLint 9+ 规范）。
 *
 * 目标：**机器化地**禁止有歧义、易误读的语法，而不是靠人工 review。
 * 全局变量用官方 `globals` 包声明，避免把浏览器/Node 全局误判为未定义。
 */

import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // —— 变量与作用域 ——
      'no-var': 'error',
      'prefer-const': 'error',
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-shadow': 'error',
      'no-use-before-define': ['error', { functions: false }],

      // —— 歧义 / 易错语法 ——
      eqeqeq: ['error', 'always'],            // 禁用 ==，必须 ===
      'no-cond-assign': 'error',              // 禁止在条件中赋值
      'no-return-assign': 'error',
      'no-sequences': 'error',                // 禁止逗号运算符
      'no-unneeded-ternary': 'error',
      'no-implicit-coercion': 'error',        // 禁止 +v / !!v / ~~v 隐式转换
      'no-void': 'error',
      'no-eq-null': 'error',                  // 禁止 == null，写显式判断
      'no-nested-ternary': 'error',           // 禁止嵌套三元
      'no-unused-expressions': ['error', { allowTernary: false, allowShortCircuit: false }],
      'no-lonely-if': 'warn',
      'no-else-return': 'warn',

      // —— 可读性 ——
      curly: ['error', 'all'],
      'prefer-template': 'error',             // 禁止用 + 拼字符串
      'prefer-arrow-callback': 'warn',
      'object-shorthand': 'warn',
      'no-param-reassign': 'warn',
      'dot-notation': 'error',
      'no-multi-assign': 'error',
      'no-plusplus': ['warn', { allowForLoopAfterthoughts: true }],
      'max-depth': ['warn', 4],
    },
  },
  {
    // 构建脚本与测试运行在 Node 环境
    files: ['build.mjs', 'test/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', '水培计算器/**'],
  },
];
