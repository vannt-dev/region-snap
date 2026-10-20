/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
((scope) => {
  // Decides when a watched region is captured after its content changes. A change waits for
  // `quiet` ms without another one, but never longer than `maxWait` after the first change, so
  // content that never settles is still captured. Captures stay `minGap` ms apart, and nothing
  // fires while one is under way: the caller says when it ended with `captured()`. The clock
  // and the timers are passed in so the timing can be tested without waiting.
  function createChangeWatcher({ quiet, maxWait, minGap, now, setTimer, clearTimer, onFire }) {
    let firstChange = null;
    let lastChange = null;
    let lastCapture = -Infinity;
    let timer = null;
    let busy = false;
    let stopped = false;

    const clear = () => {
      if (timer != null) clearTimer(timer);
      timer = null;
    };

    function fire() {
      timer = null;
      if (stopped) return;
      firstChange = null;
      lastChange = null;
      busy = true;
      onFire();
    }

    function plan() {
      clear();
      if (stopped || busy || firstChange == null) return;
      const due = Math.max(
        Math.min(lastChange + quiet, firstChange + maxWait),
        lastCapture + minGap,
      );
      timer = setTimer(fire, Math.max(0, due - now()));
    }

    return Object.freeze({
      notify() {
        if (stopped) return;
        const time = now();
        if (firstChange == null) firstChange = time;
        lastChange = time;
        plan();
      },
      captured(at = now()) {
        busy = false;
        lastCapture = at;
        plan();
      },
      stop() {
        stopped = true;
        clear();
      },
    });
  }

  // How long to wait before shot `index` (from 0) of a burst that started at `startedAt`: the
  // shots keep their interval, but stay at least `minGap` apart, which also raises a shorter
  // interval to it.
  function burstDelay({ index, startedAt, interval, lastCaptureAt, minGap, now }) {
    const step = Math.max(interval, minGap);
    const due = Math.max(startedAt + index * step, lastCaptureAt + minGap);
    return Math.max(0, due - now);
  }

  // The number in a shot's file name, padded so the files of a series sort in order.
  function shotNumber(index, total) {
    return String(index + 1).padStart(Math.max(2, String(total).length), "0");
  }

  const api = Object.freeze({ burstDelay, createChangeWatcher, shotNumber });

  scope.RegionSnapSchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
