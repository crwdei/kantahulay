const assert = require('node:assert/strict');
const { createPlayer, deferred } = require('./player-test-helpers.cjs');

async function run() {
  for (const action of ['Play', 'Reserve']) {
    const loading = deferred();
    let nextCount = 0, stopCount = 0;
    const p = createPlayer({
      [action === 'Play' ? 'playNow' : 'reserve']: () => loading.promise,
      next: async () => { nextCount++; },
      stop: async () => { stopCount++; },
    });
    const row = { code: '000002', title: 'Selected song' };
    const load = p.rowButton(row, action).props.onPress();
    p.controller.getState = () => 'LOADING';
    p.emitState('LOADING');
    await p.ui.button('Next').props.onPress();
    assert.equal(nextCount, 1, `${action}: Next must reach controller during load`);
    await p.ui.button('Stop').props.onPress();
    assert.equal(stopCount, 1, `${action}: Stop must reach controller during load`);
    loading.resolve();
    await load;
    p.ui.unmount();
  }

  for (const action of ['Play', 'Next']) {
    const loading = deferred();
    let playCount = 0, nextCount = 0, stopCount = 0;
    const p = createPlayer({
      getState: () => 'WAITING_FOR_PLAY',
      play: () => { playCount++; return loading.promise; },
      next: () => { nextCount++; return loading.promise; },
      stop: async () => { stopCount++; },
    });
    const button = p.ui.button(action);
    const first = button.props.onPress();
    const duplicate = button.props.onPress();
    p.controller.getState = () => 'LOADING';
    p.emitState('LOADING');
    await p.ui.button('Stop').props.onPress();
    assert.equal(stopCount, 1, `${action}: Stop must bypass unfinished transport load`);
    assert.equal(action === 'Play' ? playCount : nextCount, 1, 'Same-render duplicate must stay gated');
    loading.resolve();
    await Promise.all([first, duplicate]);
    p.ui.unmount();
  }

  // U13: Stop confirmation tests (>10s vs <=10s)
  {
    let stopped = false;
    let alertCalled = false;
    const p1 = createPlayer({
      getCurrentTimeMs: () => 5000,
      stop: async () => { stopped = true; },
    }, {
      Alert: {
        alert: () => { alertCalled = true; },
      },
    });
    await p1.ui.button('Stop').props.onPress();
    assert.equal(alertCalled, false, 'Stop before 10s must not prompt Alert');
    assert.equal(stopped, true, 'Stop before 10s must stop immediately');
    p1.ui.unmount();

    stopped = false;
    alertCalled = false;
    let confirmStopAction;
    const p2 = createPlayer({
      getCurrentTimeMs: () => 15000,
      stop: async () => { stopped = true; },
    }, {
      Alert: {
        alert: (title, message, buttons) => {
          alertCalled = true;
          confirmStopAction = buttons.find((b) => b.text === 'Stop')?.onPress;
        },
      },
    });
    await p2.ui.button('Stop').props.onPress();
    assert.equal(alertCalled, true, 'Stop after 10s must prompt confirmation Alert');
    assert.equal(stopped, false, 'Stop after 10s must wait for confirmation before stopping');
    assert.ok(confirmStopAction, 'Must have Stop confirmation handler');
    await confirmStopAction();
    assert.equal(stopped, true, 'Confirming stop must invoke controller.stop()');
    p2.ui.unmount();
  }
  console.log('U04 production transport handlers: PASS');
}

if (require.main === module) run().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { run };
