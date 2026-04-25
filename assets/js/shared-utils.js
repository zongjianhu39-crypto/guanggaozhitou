(function attachSharedUtils(window) {
  'use strict';

  function escapeHtml(value) {
    return String(value != null ? value : '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.sharedUtils = {
    escapeHtml: escapeHtml,
  };
})(window);
