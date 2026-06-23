// font-control.js — manages font size scaling for DC Collection Tool
// External file (required by MV3 CSP — inline <script> is blocked).
// All CSS font-sizes use rem units; changing html.fontSize scales everything.

var DC_FONT_BASE_PX = [16, 17, 18, 19, 20];
var DC_FONT_STORE   = 'dc_font_level';

function dcApplyFontLevel(level) {
  var px = DC_FONT_BASE_PX[level];
  // Set directly on <html> element — highest specificity, no CSP concerns
  document.documentElement.style.setProperty('font-size', px + 'px', 'important');
  document.querySelectorAll('.font-size-btn').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.level, 10) === level);
  });
  try { localStorage.setItem(DC_FONT_STORE, String(level)); } catch(e) {}
}

function dcAttachFontListeners() {
  document.querySelectorAll('.font-size-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      dcApplyFontLevel(parseInt(btn.dataset.level, 10));
    }, true);
  });
}

// Attach listeners
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', dcAttachFontListeners);
} else {
  dcAttachFontListeners();
}

// Restore saved level (default: 0 = 13px)
(function() {
  var saved = 0;
  try { saved = parseInt(localStorage.getItem(DC_FONT_STORE) || '0', 10); } catch(e) {}
  dcApplyFontLevel(Math.min(DC_FONT_BASE_PX.length - 1, Math.max(0, saved || 0)));
})();
