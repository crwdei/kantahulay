const assert = require('node:assert/strict');
const React = require('react');
const { createUiEnvironment, findNodes, extractText } = require('./ui-ux.check.cjs');
const { deferred, settle } = require('./player-test-helpers.cjs');

async function testClassLifecycle() {
  const env = createUiEnvironment();
  const { ErrorBoundary } = env.loadModule('src/components/ErrorBoundary.tsx');

  let resetCount = 0;
  const boundary = new ErrorBoundary({
    scope: 'player',
    fallbackTitle: 'Player Fault',
    onReset: () => { resetCount++; },
    children: React.createElement('Text', {}, 'Child OK'),
  });

  const state1 = boundary.render();
  assert.equal(boundary.state.hasError, false);
  assert.ok(extractText(state1).includes('Child OK'));

  // getDerivedStateFromError
  const derived = ErrorBoundary.getDerivedStateFromError(new Error('Simulated crash'));
  assert.equal(derived.hasError, true);
  assert.equal(derived.error.message, 'Simulated crash');

  // Trigger error state in boundary
  boundary.state = derived;
  const fallbackTree = boundary.render();
  assert.ok(extractText(fallbackTree).includes('Player Fault'));
  assert.ok(extractText(fallbackTree).includes('Simulated crash'));

  boundary.updater = {
    enqueueSetState(inst, partialState) {
      const next = typeof partialState === 'function' ? partialState(inst.state, inst.props) : partialState;
      inst.state = { ...inst.state, ...next };
    },
  };
  const reloadBtn = findNodes(fallbackTree, (n) => n.props?.accessibilityLabel === 'Reload Player')[0];
  assert.ok(reloadBtn, 'Must render Reload Player button');
  reloadBtn.props.onPress();
  assert.equal(boundary.state.hasError, false);
  assert.equal(resetCount, 1, 'onReset callback must fire on reload');

  console.log('ErrorBoundary class lifecycle: PASS');
}

async function testAppResilience() {
  const env = createUiEnvironment();
  const mockSettingsDao = {
    SettingsDao: {
      isOnboardingCompleted: async () => true,
      getLanguage: async () => 'en',
      setLanguage: async () => {},
    },
  };

  let stopCount = 0;
  let initCalls = 0;
  const mockController = {
    getState: () => 'PLAYING',
    getActiveSong: () => ({ code: '000001', title: 'Persisting Song' }),
    getActiveReservation: () => null,
    getPendingQueue: () => [],
    getKeyOffset: () => 0,
    getTotalTimeMs: () => 60000,
    getCurrentTimeMs: () => 1000,
    getLyricSync: () => ({ getDisplayWindow: () => ({ line1Text: 'L1', line2Text: 'L2', line1Words: [], line2Words: [], activeLine: 1, countdownDots: 0 }) }),
    isSongEnded: () => false,
    handleSongEnded: async () => {},
    initializeAsync: async () => { initCalls++; return { totalSongs: 50 }; },
    addListener: () => () => {},
    stop: async () => { stopCount++; },
    pause: () => {},
  };

  const App = env.loadModule('App.tsx', {
    './src/db/settingsDao': mockSettingsDao,
    './src/engine/PlaybackController': { PlaybackController: function() { return mockController; } },
  }).default;

  const appUi = env.mountUi(App);
  await appUi.flushEffects();

  // Find inner player ErrorBoundary
  const boundaries = appUi.find((n) => n?.type?.name === 'ErrorBoundary');
  assert.ok(boundaries.length >= 2, 'Must nest root and player error boundaries');
  const playerBoundary = boundaries.find((b) => b.props?.scope === 'player');
  assert.ok(playerBoundary, 'Must have player-scoped ErrorBoundary');

  // Trigger remount of player boundary
  assert.equal(stopCount, 0, 'Audio/stop must NOT be triggered during reset');
  playerBoundary.props.onReset();
  await appUi.flushEffects();

  assert.equal(stopCount, 0, 'Audio still not stopped after player reset');
  appUi.unmount();
  console.log('App ErrorBoundary integration: PASS');
}

async function testTickerFaultNotice() {
  const env = createUiEnvironment();
  let tickerFails = true;
  const controller = {
    getState: () => 'PLAYING',
    getActiveSong: () => ({ code: '000001', title: 'Active' }),
    getActiveReservation: () => null,
    getPendingQueue: () => [],
    getKeyOffset: () => 0,
    getTotalTimeMs: () => 60000,
    getCurrentTimeMs: () => {
      if (tickerFails) throw new Error('Corrupted audio frame clock');
      return 5000;
    },
    getLyricSync: () => ({ getDisplayWindow: () => ({ line1Text: 'L1', line2Text: 'L2', line1Words: [], line2Words: [], activeLine: 1, countdownDots: 0 }) }),
    isSongEnded: () => false,
    handleSongEnded: async () => {},
    initializeAsync: async () => ({ totalSongs: 10 }),
    addListener: () => () => {},
    play: async () => {}, pause: () => {}, stop: async () => {}, next: async () => {},
    setKeyOffset: () => {},
  };

  const { PlayerScreen } = env.loadModule('src/screens/Player.tsx');
  const ui = env.mountUi(PlayerScreen, { controller, initialShowOnboarding: false });
  await ui.flushEffects();

  // Advance fake timer to fire setInterval ticker
  env.fakeTimers.advanceTimersByTime(50);
  ui.render();

  assert.ok(ui.text().includes('Corrupted audio frame clock'), 'Must surface ticker error notice');

  // Recover ticker
  tickerFails = false;
  env.fakeTimers.advanceTimersByTime(50);
  ui.render();

  ui.unmount();
  console.log('Player ticker fault notice: PASS');
}

async function run() {
  await testClassLifecycle();
  await testAppResilience();
  await testTickerFaultNotice();
  console.log('B16 ErrorBoundary tests: ALL PASS');
}

if (require.main === module) run().catch((err) => { console.error(err); process.exitCode = 1; });
module.exports = { run };
