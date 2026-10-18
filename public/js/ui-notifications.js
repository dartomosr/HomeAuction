import { dom } from './dom.js';
import { playUiMessageSound } from './audio.js';

function showToast(msg) {
  playUiMessageSound();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

export { showToast };
