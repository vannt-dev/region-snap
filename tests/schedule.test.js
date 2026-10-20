const assert = require("node:assert/strict");
const test = require("node:test");
const schedule = require("../schedule.js");

// A clock and timers that only move when the test says so.
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (callback, delay) => {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, delay), callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

const options = { quiet: 400, maxWait: 2000, minGap: 600 };

test("a change is captured once the region has been quiet for a moment", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    ...time,
    onFire: () => fired.push(time.now()),
  });
  watcher.notify();
  time.advance(399);
  assert.deepEqual(fired, []);
  time.advance(1);
  assert.deepEqual(fired, [400]);
});

test("a burst of changes is captured once, after the last of them", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    ...time,
    onFire: () => fired.push(time.now()),
  });
  for (let step = 0; step < 5; step += 1) {
    watcher.notify();
    time.advance(100);
  }
  time.advance(1000);
  assert.deepEqual(fired, [800], "400 ms after the fifth change at 400 ms");
});

test("content that never settles is still captured, at the longest wait", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    ...time,
    onFire: () => fired.push(time.now()),
  });
  for (let step = 0; step < 30; step += 1) {
    watcher.notify();
    time.advance(100);
  }
  assert.equal(fired[0], 2000);
});

test("captures are never closer together than the capture interval", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    quiet: 100,
    ...time,
    onFire: () => {
      fired.push(time.now());
      watcher.captured(time.now());
    },
  });
  watcher.notify();
  time.advance(150);
  watcher.notify();
  time.advance(1000);
  assert.deepEqual(fired, [100, 700]);
});

test("a change during a capture is captured after it", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    ...time,
    onFire: () => fired.push(time.now()),
  });
  watcher.notify();
  time.advance(400);
  assert.deepEqual(fired, [400]);
  // The capture takes 300 ms; the page changes in the middle of it.
  time.advance(150);
  watcher.notify();
  time.advance(150);
  watcher.captured(time.now());
  time.advance(2000);
  assert.deepEqual(fired, [400, 1300], "no sooner than the interval after the capture ended");
});

test("a stopped watcher fires no more", () => {
  const time = fakeTime();
  const fired = [];
  const watcher = schedule.createChangeWatcher({
    ...options,
    ...time,
    onFire: () => fired.push(time.now()),
  });
  watcher.notify();
  watcher.stop();
  time.advance(5000);
  watcher.notify();
  time.advance(5000);
  assert.deepEqual(fired, []);
  assert.equal(time.pending(), 0);
});

test("burst shots keep their interval, but never closer than the capture interval", () => {
  const plan = { startedAt: 1000, interval: 1000, minGap: 600 };
  assert.equal(schedule.burstDelay({ ...plan, index: 0, lastCaptureAt: 0, now: 1000 }), 0);
  assert.equal(schedule.burstDelay({ ...plan, index: 1, lastCaptureAt: 1200, now: 1300 }), 700);
  // A slow shot pushes the next one back to keep clear of Chrome's quota.
  assert.equal(schedule.burstDelay({ ...plan, index: 2, lastCaptureAt: 2900, now: 2950 }), 550);
  // A requested interval below the capture interval is raised to it.
  assert.equal(
    schedule.burstDelay({ ...plan, interval: 100, index: 3, lastCaptureAt: 1000, now: 1000 }),
    1000 + 3 * 600 - 1000,
  );
});

test("shot numbers are padded so the files sort in order", () => {
  assert.equal(schedule.shotNumber(0, 5), "01");
  assert.equal(schedule.shotNumber(9, 20), "10");
  assert.equal(schedule.shotNumber(4, 150), "005");
});
