const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { windowLifecycle } = require("../src/window-lifecycle.cjs");
function fixture(full = false, simple = false) {
  const w = new EventEmitter();
  Object.assign(w, {
    full,
    simple,
    hidden: false,
    isDestroyed: () => false,
    isFullScreen() {
      return this.full;
    },
    isSimpleFullScreen() {
      return this.simple;
    },
    setSimpleFullScreen(v) {
      this.simple = v;
    },
    setFullScreen(v) {
      this.requested = v;
    },
    hide() {
      assert.equal(this.full, false);
      assert.equal(this.simple, false);
      this.hidden = true;
    },
    isMinimized: () => false,
    show() {
      this.hidden = false;
    },
    focus() {},
  });
  return [w, windowLifecycle(w)];
}
test("native fullscreen must finish leaving before hiding", () => {
  const [w, c] = fixture(true);
  c.hide();
  c.hide();
  assert.equal(w.hidden, false);
  assert.equal(w.requested, false);
  w.full = false;
  w.emit("leave-full-screen");
  assert.equal(w.hidden, true);
});
test("reopen during transition cancels pending hide", () => {
  const [w, c] = fixture(true);
  c.hide();
  c.show();
  w.full = false;
  w.emit("leave-full-screen");
  assert.equal(w.hidden, false);
});
test("close during entry waits for entry then exits", () => {
  const [w, c] = fixture();
  w.emit("will-enter-full-screen");
  c.hide();
  assert.equal(w.hidden, false);
  w.full = true;
  w.emit("enter-full-screen");
  assert.equal(w.requested, false);
  w.full = false;
  w.emit("leave-full-screen");
  assert.equal(w.hidden, true);
});
test("simple fullscreen exits before hide; normal window can reopen", () => {
  const [w, c] = fixture(false, true);
  c.hide();
  assert.equal(w.hidden, true);
  c.show();
  assert.equal(w.hidden, false);
  c.hide();
  assert.equal(w.hidden, true);
});
