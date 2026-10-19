const { createUiEnvironment, findNodes } = require('./ui-ux.check.cjs');

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function createPlayer(overrides = {}, envOverrides = {}) {
  let listener;
  const controller = {
    getState: () => 'PLAYING',
    getActiveSong: () => ({ code: '000001', title: 'Active song' }),
    getActiveReservation: () => null,
    getPendingQueue: () => [],
    getKeyOffset: () => 0,
    getTotalTimeMs: () => 60000,
    getCurrentTimeMs: () => 5000,
    getLyricSync: () => ({ getDisplayWindow: () => ({
      line1Text: 'CURRENT LYRICS', line2Text: 'NEXT LYRICS',
      line1Words: [], line2Words: [], activeLine: 1, countdownDots: 0,
    }) }),
    isSongEnded: () => false,
    handleSongEnded: async () => {},
    initializeAsync: async () => ({ totalSongs: 100 }),
    addListener: (l) => { listener = l; return () => { listener = null; }; },
    play: async () => {}, pause: async () => {}, stop: async () => {}, next: async () => {},
    playNow: async () => {}, reserve: async () => {}, setKeyOffset: async () => {},
    ...overrides,
  };
  const songDao = { search: async () => [], count: async () => 100 };
  const env = createUiEnvironment({
    '../db/songDao': { SongDao: songDao },
    '../db/settingsDao': { SettingsDao: {
      getLanguage: async () => 'en', isOnboardingCompleted: async () => true,
      setLanguage: async () => {},
    } },
    ...envOverrides,
  });
  const ui = env.mountUi('src/screens/Player.tsx', { controller, initialShowOnboarding: false });
  return {
    env, ui, controller, songDao,
    emitState(state) { listener?.onStateChange(state); ui.render(); },
    list() { return ui.find('FlatList')[0]; },
    input(query) { ui.find('TextInput')[0].props.onChangeText(query); ui.render(); },
    debounce() { env.fakeTimers.advanceTimersByTime(200); ui.render(); },
    open() { ui.button('Songbook').props.onPress(); ui.render(); },
    rowButton(item, label) {
      const row = ui.find('FlatList')[0].props.renderItem({ item });
      return findNodes(row, (n) => n.props?.accessibilityLabel === `${label} ${item.title}`)[0];
    },
  };
}

module.exports = { createPlayer, deferred, settle };
