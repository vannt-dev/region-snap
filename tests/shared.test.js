const assert = require("node:assert/strict");
const test = require("node:test");

const shared = require("../shared.js");

test("shared communication contract is immutable and internally consistent", () => {
  assert.equal(Object.isFrozen(shared), true);
  assert.equal(Object.isFrozen(shared.MESSAGE), true);
  assert.equal(Object.isFrozen(shared.STATE), true);
  assert.deepEqual(Object.values(shared.COMMAND_TO_MESSAGE).sort(), [
    shared.MESSAGE.DO_CAPTURE,
    shared.MESSAGE.START_PICKING,
  ]);
  assert.equal(new Set(shared.ALLOWED_PROTOCOLS).size, shared.ALLOWED_PROTOCOLS.length);
});
