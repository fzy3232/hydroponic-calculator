/**
 * 应用入口：装配视图层。
 * @module main
 */

import { init } from './ui/view.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
