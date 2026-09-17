// Native fullscreen transitions are asynchronous on macOS. Never hide a
// window while it still owns a fullscreen Space.
function windowLifecycle(win) {
  let pendingHide = false;
  let entering = false;
  let leaving = false;
  function finish() {
    if (!pendingHide || entering || leaving || win.isDestroyed()) return;
    if (win.isSimpleFullScreen()) win.setSimpleFullScreen(false);
    if (win.isFullScreen()) {
      leaving = true;
      win.setFullScreen(false);
      return;
    }
    pendingHide = false;
    win.hide();
  }
  win.on("enter-full-screen", () => {
    entering = false;
    finish();
  });
  win.on("will-enter-full-screen", () => {
    entering = true;
  });
  win.on("leave-full-screen", () => {
    leaving = false;
    finish();
  });
  win.on("will-leave-full-screen", () => {
    leaving = true;
  });
  return {
    hide() {
      pendingHide = true;
      finish();
    },
    show() {
      pendingHide = false;
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
  };
}
module.exports = { windowLifecycle };
