function bindWindowMode(window) {
  let requested = window.isFullScreen();
  const getState = () => ({ fullscreen: window.isFullScreen() });
  const publish = () => {
    requested = window.isFullScreen();
    window.webContents.send('homeauction:window-mode', getState());
  };
  const set = fullscreen => {
    requested = fullscreen;
    window.setFullScreen(fullscreen);
  };
  window.on('enter-full-screen', publish);
  window.on('leave-full-screen', publish);
  window.webContents.on('did-finish-load', publish);
  // WebContents receives input even when the embedded stage frame has focus.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      if (!input.isAutoRepeat) set(!requested);
    } else if (input.key === 'Escape' && requested) {
      event.preventDefault();
      set(false);
    }
  });
  return { getState, toggle: () => set(!requested), exit: () => set(false) };
}

module.exports = { bindWindowMode };
