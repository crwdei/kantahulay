const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createUiEnvironment(customOverrides = {}) {
  const cache = new Map();
  let activeRunner = null;
  let nextTimer = 1;
  const timers = new Map();
  let currentTime = 0;

  const fakeTimers = {
    setTimeout(fn, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { fn, triggerTime: currentTime + delay, delay, interval: false });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { fn, triggerTime: currentTime + delay, delay, interval: true });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    advanceTimersByTime(ms) {
      currentTime += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.triggerTime <= currentTime)
        .sort((a, b) => a[1].triggerTime - b[1].triggerTime);
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        if (!t.interval) timers.delete(id);
        else t.triggerTime = currentTime + t.delay;
        t.fn();
      }
    },
    runAllTimers() {
      let loops = 0;
      while (timers.size > 0 && loops < 1000) {
        loops++;
        const next = [...timers.entries()].sort((a, b) => a[1].triggerTime - b[1].triggerTime)[0];
        if (!next) break;
        currentTime = Math.max(currentTime, next[1].triggerTime);
        const [id, t] = next;
        if (!t.interval) timers.delete(id);
        else t.triggerTime = currentTime + t.delay;
        t.fn();
      }
    },
    clearAllTimers() {
      timers.clear();
    },
  };

  const React = {
    Component: require('react').Component,
    createElement(type, props, ...children) {
      const flatChildren = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false);
      const normalizedChildren = flatChildren.length === 1 ? flatChildren[0] : (flatChildren.length === 0 ? undefined : flatChildren);
      return {
        type,
        props: {
          ...props,
          ...(normalizedChildren !== undefined ? { children: normalizedChildren } : {}),
        },
      };
    },
    Fragment: Symbol('Fragment'),
    useState: (initial) => {
      if (!activeRunner) throw new Error('useState called outside active runner');
      return activeRunner.useState(initial);
    },
    useRef: (initial) => {
      if (!activeRunner) throw new Error('useRef called outside active runner');
      return activeRunner.useRef(initial);
    },
    useEffect: (fn, deps) => {
      if (!activeRunner) throw new Error('useEffect called outside active runner');
      return activeRunner.useEffect(fn, deps);
    },
    useCallback: (fn, deps) => {
      if (!activeRunner) throw new Error('useCallback called outside active runner');
      return activeRunner.useCallback(fn, deps);
    },
    useMemo: (fn, deps) => {
      if (!activeRunner) throw new Error('useMemo called outside active runner');
      return activeRunner.useMemo(fn, deps);
    },
  };

  const AccessibilityInfo = {
    isReduceMotionEnabled: async () => false,
    getRecommendedTimeoutMillis: async (original) => original,
    addEventListener: () => ({ remove: () => {} }),
    announceForAccessibility: () => {},
  };

  const AppState = {
    currentState: 'active',
    addEventListener: () => ({ remove: () => {} }),
  };

  const Keyboard = {
    dismiss: () => {},
    addListener: () => ({ remove: () => {} }),
  };

  const StatusBar = () => null;
  StatusBar.currentHeight = 24;

  const LayoutAnimation = {
    configureNext: () => {},
    Types: { easeInEaseOut: 'easeInEaseOut' },
    Properties: { opacity: 'opacity' },
    Presets: { easeInEaseOut: {} },
  };

  const UIManager = {
    setLayoutAnimationEnabledExperimental: () => {},
  };

  const reactNative = {
    View: 'View',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    TouchableHighlight: 'TouchableHighlight',
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    Pressable: 'Pressable',
    SafeAreaView: 'SafeAreaView',
    Modal: 'Modal',
    TextInput: 'TextInput',
    FlatList: 'FlatList',
    ScrollView: 'ScrollView',
    Image: 'Image',
    StyleSheet: {
      create: (styles) => styles,
      flatten: (style) => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {}),
    },
    Platform: { OS: 'android', select: (obj) => obj.android ?? obj.default },
    StatusBar,
    AccessibilityInfo,
    AppState,
    Keyboard,
    LayoutAnimation,
    UIManager,
    Animated: {
      Value: class {
        constructor(v = 0) {
          this._value = v;
        }
        setValue(v) {
          this._value = v;
        }
        interpolate(config) {
          return config?.outputRange?.[0] ?? '0deg';
        }
        addListener() { return 'sub_id'; }
        removeListener() {}
        removeAllListeners() {}
      },
      View: 'Animated.View',
      Text: 'Animated.Text',
      Image: 'Animated.Image',
      ScrollView: 'Animated.ScrollView',
      timing: () => ({ start(cb) { cb?.({ finished: true }); }, stop() {} }),
      spring: () => ({ start(cb) { cb?.({ finished: true }); }, stop() {} }),
      decay: () => ({ start(cb) { cb?.({ finished: true }); }, stop() {} }),
      delay: () => ({ start(cb) { cb?.({ finished: true }); }, stop() {} }),
      sequence: (anims = []) => ({
        start(cb) {
          for (const a of anims) a?.start?.();
          cb?.({ finished: true });
        },
        stop() {},
      }),
      parallel: (anims = []) => ({
        start(cb) {
          for (const a of anims) a?.start?.();
          cb?.({ finished: true });
        },
        stop() {},
      }),
      loop: (anim) => ({
        start(cb) {
          anim?.start?.();
          cb?.({ finished: true });
        },
        stop() {},
      }),
    },
    Easing: { ease: (v) => v, inOut: (fn) => fn },
    BackHandler: { addEventListener: () => ({ remove() {} }), exitApp() {} },
    Alert: customOverrides.Alert || { alert() {} },
    useWindowDimensions: () => (customOverrides.windowDimensions || { width: 375, height: 812 }),
  };

  const safeAreaContext = {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: 'SafeAreaView',
    useSafeAreaInsets: () => (customOverrides.safeAreaInsets || { top: 24, right: 0, bottom: 0, left: 0 }),
  };

  function loadModule(filePath, fileOverrides = {}) {
    const resolvedPath = path.resolve(root, filePath);
    if (cache.has(resolvedPath)) {
      return cache.get(resolvedPath).exports;
    }

    const sourceCode = fs.readFileSync(resolvedPath, 'utf8');
    const transpiled = ts.transpileModule(sourceCode, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText;

    const moduleObj = { exports: {} };
    cache.set(resolvedPath, moduleObj);

    function localRequire(importName) {
      if (customOverrides[importName]) return customOverrides[importName];
      if (fileOverrides[importName]) return fileOverrides[importName];
      if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(importName)) return 1;

      if (importName === 'react') return React;
      if (importName === 'react-native') return reactNative;
      if (importName === 'react-native-safe-area-context') return safeAreaContext;
      if (importName === 'expo-modules-core') return {
        requireNativeModule: () => {
          throw new Error('Native module not available in test harness');
        },
      };
      if (importName === 'expo-sqlite') {
        return {
          openDatabaseAsync: async () => ({
            execAsync: async () => {},
            runAsync: async () => ({ lastInsertRowId: 1, changes: 1 }),
            getAllAsync: async () => [],
            getFirstAsync: async () => null,
            withTransactionAsync: async (fn) => fn(),
            closeAsync: async () => {},
          }),
        };
      }

      if (importName.startsWith('.')) {
        const dir = path.dirname(resolvedPath);
        const targetBase = path.resolve(dir, importName);
        const candidates = [
          targetBase + '.ts',
          targetBase + '.tsx',
          targetBase + '.js',
          targetBase + '.jsx',
          path.join(targetBase, 'index.ts'),
          path.join(targetBase, 'index.tsx'),
          path.join(targetBase, 'index.js'),
        ];
        const found = candidates.find((c) => fs.existsSync(c));
        if (found) {
          return loadModule(found, fileOverrides);
        }
      }

      return require(importName);
    }

    const sandbox = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: localRequire,
      console,
      setTimeout: fakeTimers.setTimeout,
      clearTimeout: fakeTimers.clearTimeout,
      setInterval: fakeTimers.setInterval,
      clearInterval: fakeTimers.clearInterval,
      Buffer,
      process,
    };

    vm.runInNewContext(transpiled, sandbox, { filename: resolvedPath });
    return moduleObj.exports;
  }

  function mountUi(ComponentOrPath, initialProps = {}, fileOverrides = {}) {
    let Component;
    if (typeof ComponentOrPath === 'string') {
      const loaded = loadModule(ComponentOrPath, fileOverrides);
      Component = loaded.default || Object.values(loaded).find(v => typeof v === 'function');
      if (!Component) throw new Error(`Could not find exported Component in ${ComponentOrPath}`);
    } else {
      Component = ComponentOrPath;
    }

    let props = { ...initialProps };
    const slots = [];
    let slotIndex = 0;
    let pendingEffects = [];
    let isMounted = true;

    const areDepsEqual = (a, b) => {
      if (!a || !b || a.length !== b.length) return false;
      return a.every((x, i) => Object.is(x, b[i]));
    };

    const runner = {
      tree: null,
      props,
      updatesAfterUnmount: 0,
      useState(initial) {
        const i = slotIndex++;
        if (!slots[i]) {
          slots[i] = {
            kind: 'state',
            value: typeof initial === 'function' ? initial() : initial,
          };
        }
        const setState = (newValue) => {
          if (!isMounted) { runner.updatesAfterUnmount++; return; }
          const next = typeof newValue === 'function' ? newValue(slots[i].value) : newValue;
          slots[i].value = next;
        };
        return [slots[i].value, setState];
      },
      useRef(initial) {
        const i = slotIndex++;
        if (!slots[i]) {
          slots[i] = { kind: 'ref', current: initial };
        }
        return slots[i];
      },
      useCallback(fn, deps) {
        const i = slotIndex++;
        if (!slots[i] || !areDepsEqual(slots[i].deps, deps)) {
          slots[i] = { kind: 'callback', value: fn, deps };
        }
        return slots[i].value;
      },
      useMemo(fn, deps) {
        const i = slotIndex++;
        if (!slots[i] || !areDepsEqual(slots[i].deps, deps)) {
          slots[i] = { kind: 'memo', value: fn(), deps };
        }
        return slots[i].value;
      },
      useEffect(fn, deps) {
        const i = slotIndex++;
        if (!slots[i] || !areDepsEqual(slots[i].deps, deps)) {
          const old = slots[i];
          slots[i] = { kind: 'effect', deps, cleanup: old?.cleanup };
          pendingEffects.push(() => {
            if (typeof slots[i].cleanup === 'function') {
              try { slots[i].cleanup(); } catch (e) { console.error('Effect cleanup error:', e); }
            }
            slots[i].cleanup = fn();
          });
        }
      },
      render() {
        if (!isMounted) throw new Error('Cannot render unmounted component');
        slotIndex = 0;
        pendingEffects = [];
        activeRunner = runner;
        try {
          runner.tree = Component(props);
        } finally {
          activeRunner = null;
        }
        const effectsToRun = pendingEffects;
        pendingEffects = [];
        for (const ef of effectsToRun) {
          ef();
        }
        return runner.tree;
      },
      setProps(nextProps) {
        props = { ...props, ...nextProps };
        runner.props = props;
        return runner.render();
      },
      async flushEffects() {
        for (let i = 0; i < 10; i++) {
          await Promise.resolve();
        }
        runner.render();
      },
      unmount() {
        isMounted = false;
        for (const slot of slots) {
          if (slot && slot.kind === 'effect' && typeof slot.cleanup === 'function') {
            try { slot.cleanup(); } catch (e) { console.error('Unmount cleanup error:', e); }
          }
        }
      },
      text() {
        return extractText(runner.tree);
      },
      find(predicateOrType, matchingProps) {
        return findNodes(runner.tree, predicateOrType, matchingProps);
      },
      button(label) {
        const candidates = findNodes(runner.tree, (node) => {
          if (!node || typeof node !== 'object') return false;
          const isButtonRole = node.props?.accessibilityRole === 'button';
          const hasPress = typeof node.props?.onPress === 'function';
          const isTouch = typeof node.type === 'string' && (node.type.includes('Touch') || node.type === 'Pressable');
          return isButtonRole || hasPress || isTouch;
        });

        for (const c of candidates) {
          if (c.props?.accessibilityLabel === label) return c;
          const innerText = extractText(c);
          if (innerText.trim() === label || innerText.includes(label)) return c;
        }
        return null;
      },
    };

    runner.render();
    return runner;
  }

  return {
    React,
    reactNative,
    fakeTimers,
    loadModule,
    mountUi,
    AccessibilityInfo,
    AppState,
    Keyboard,
  };
}

function extractText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && node.props) {
    return extractText(node.props.children);
  }
  return '';
}

function findNodes(tree, predicateOrType, matchingProps) {
  const matches = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    let matched = false;
    if (typeof predicateOrType === 'string') {
      matched = node.type === predicateOrType;
    } else if (typeof predicateOrType === 'function') {
      matched = predicateOrType(node);
    }
    if (matched && matchingProps) {
      for (const [k, v] of Object.entries(matchingProps)) {
        if (node.props?.[k] !== v) {
          matched = false;
          break;
        }
      }
    }
    if (matched) {
      matches.push(node);
    }
    if (node.props?.children) {
      walk(node.props.children);
    }
  }
  walk(tree);
  return matches;
}

// Self-tests for the harness contract
async function runHarnessContractTests() {
  const env = createUiEnvironment();
  const { React, mountUi } = env;

  let effectRunCount = 0;
  let cleanupRunCount = 0;
  let renderCount = 0;
  let refInstance1 = null;
  let refInstance2 = null;

  function TestComponent({ count, tag }) {
    renderCount++;
    const [local, setLocal] = React.useState(10);
    const ref1 = React.useRef({ id: 'test-ref' });
    const ref2 = React.useRef({ id: 'test-ref-2' });
    refInstance1 = ref1;
    refInstance2 = ref2;

    React.useEffect(() => {
      effectRunCount++;
      return () => {
        cleanupRunCount++;
      };
    }, [tag]);

    return React.createElement(
      'View',
      { accessibilityRole: 'none' },
      React.createElement('Text', {}, `Count: ${count}, Local: ${local}, Tag: ${tag}`),
      React.createElement(
        'TouchableOpacity',
        {
          accessibilityRole: 'button',
          accessibilityLabel: 'Increment Local',
          onPress: () => setLocal(l => l + 1),
        },
        React.createElement('Text', {}, 'Click Me')
      )
    );
  }

  const ui = mountUi(TestComponent, { count: 1, tag: 'A' });

  // 1. Initial render checks
  assert.equal(renderCount, 1, 'Initial render must occur once');
  assert.equal(effectRunCount, 1, 'Initial effect must run once');
  assert.equal(cleanupRunCount, 0, 'No cleanup on initial render');
  assert.match(ui.text(), /Count: 1, Local: 10, Tag: A/);

  // 2. Button finder and state update
  const btn = ui.button('Increment Local');
  assert.ok(btn, 'Must locate button by accessibilityLabel');
  btn.props.onPress();
  ui.render();
  assert.match(ui.text(), /Count: 1, Local: 11, Tag: A/);

  // 3. Changing props rerenders; unchanged deps do not rerun effect
  const oldRef1 = refInstance1;
  const oldRef2 = refInstance2;
  ui.setProps({ count: 2, tag: 'A' });
  assert.equal(renderCount, 3, 'Must rerender on setProps');
  assert.equal(effectRunCount, 1, 'Effect with unchanged deps must not rerun');
  assert.equal(cleanupRunCount, 0, 'Cleanup must not run when deps unchanged');
  assert.equal(refInstance1, oldRef1, 'useRef must be stable across rerenders');
  assert.equal(refInstance2, oldRef2, 'Second useRef must be stable across rerenders');
  assert.match(ui.text(), /Count: 2, Local: 11, Tag: A/);

  // 4. Changing deps reruns effect and runs cleanup
  ui.setProps({ count: 2, tag: 'B' });
  assert.equal(effectRunCount, 2, 'Effect must rerun when dep changes');
  assert.equal(cleanupRunCount, 1, 'Cleanup must run before new effect runs');

  // 5. Unmount runs cleanup
  ui.unmount();
  assert.equal(cleanupRunCount, 2, 'Unmount must run effect cleanup');

  console.log('UI Harness contract self-test: PASS');

  // Test SettingsModal truthful library info (T02 / F07)
  const SettingsModal = env.loadModule('src/components/SettingsModal.tsx').SettingsModal;

  const settingsDev = env.mountUi(SettingsModal, {
    visible: true,
    onClose: () => {},
    language: 'en',
    onLanguageChange: () => {},
    theme: 'dark',
    onThemeChange: () => {},
    packFormatVersion: 2,
  });
  assert.ok(settingsDev.text().includes('tonyo'), 'Must display developer credit with tonyo');
  assert.ok(!settingsDev.text().includes('Target: Android 10+'), 'Must remove target specs string');
  assert.ok(!settingsDev.text().includes('47,997'), 'Must not display hardcoded song count');
  assert.ok(settingsDev.text().includes('v2.0 (songs.kpak)'), 'Must reflect packFormatVersion');
  assert.ok(!settingsDev.text().includes('Light'), 'Must not render fake Light theme option (F10)');
  assert.ok(!settingsDev.text().includes('System'), 'Must not render fake System theme option (F10)');
  assert.ok(!settingsDev.text().includes('Community MIDI karaoke catalog.'), 'Must remove community midi notice');
  assert.equal(settingsDev.text().includes('Bisaya'), false, 'Language selector must be hidden for English-only mode');
  assert.ok(settingsDev.text().includes('MUSIC VOLUME'), 'Must show MUSIC VOLUME section in settings');
  assert.ok(settingsDev.text().includes('Master Music Gain'), 'Must show Master Music Gain control');
  const settingsCloseBtn = settingsDev.find((n) => n.props && n.props.accessibilityLabel === 'Close')[0];
  assert.ok(settingsCloseBtn, 'SettingsModal close button must have accessibilityLabel Close');
  settingsDev.unmount();

  console.log('SettingsModal truthful count check: PASS');

  // Test Player feedback and scoped error behavior (T03 / F01, F14)
  const PlayerScreen = env.loadModule('src/screens/Player.tsx').PlayerScreen;

  function createTestController() {
    let listener = null;
    const lyricWindow = {
      line1Words: [],
      line2Words: [],
      line1Text: 'CURRENT LYRICS TEXT',
      line2Text: 'NEXT LYRICS TEXT',
      activeLine: 1,
      activeRatio: 0,
      countdownDots: 0,
    };
    return {
      getState: () => 'PLAYING',
      getActiveSong: () => ({ code: '000001', title: 'Sample Song', artist: 'Artist' }),
      getActiveReservation: () => ({ reservation_id: 1, song_code: '000001', title: 'Sample Song' }),
      getPendingQueue: () => [],
      getKeyOffset: () => 0,
      isAudioReady: () => true,
      isCatalogReady: () => true,
      getTotalSongs: () => 10,
      getPackFormatVersion: () => 1,
      isPreparingSound: () => false,
      initializeAsync: async () => ({ audioReady: true, catalogReady: true, totalSongs: 10, packFormatVersion: 1 }),
      addListener: (l) => { listener = l; return () => {}; },
      getLyricSync: () => ({ getDisplayWindow: () => lyricWindow }),
      getCurrentTimeMs: () => 500,
      isSongEnded: () => false,
      play: async () => {},
      pause: () => {},
      stop: async () => {},
      next: async () => {},
      setKeyOffset: async () => {},
      reserve: async () => {},
      playNow: async () => {},
      getQueueNeedsRefresh: () => false,
      refreshQueueAsync: async () => {},
      emitError: (msg, code) => listener?.onError?.(msg, code),
      emitState: (s) => listener?.onStateChange?.(s),
    };
  }

  const ctrl = createTestController();
  const playerUi = env.mountUi(PlayerScreen, { controller: ctrl });
  playerUi.render();

  // Empty / Idle state branding and copy assertions
  const idleCtrl = createTestController();
  idleCtrl.getState = () => 'IDLE';
  idleCtrl.getActiveSong = () => null;
  idleCtrl.getActiveReservation = () => null;
  const idleUi = env.mountUi(PlayerScreen, { controller: idleCtrl });
  idleUi.render();

  const idleLogoNode = idleUi.find((n) => n.type === 'Image' && n.props?.accessibilityLabel === 'Kantahulay Logo')[0];
  assert.ok(!idleLogoNode, 'Empty state must not render logo on screen');
  assert.ok(idleUi.text().includes('Pick a song to begin'), 'Empty state must render concise helper: Pick a song to begin');
  assert.ok(!idleUi.text().includes('Select a song from Songbook to begin'), 'Old long helper text must be removed');
  assert.ok(!idleUi.text().includes('Press Play to start'), 'Yellow Press Play to start text must be removed from idle card');
  idleUi.unmount();

  // Emitting playback error while playing must not hide lyrics
  ctrl.emitError('Audio decode failed');
  playerUi.render();
  assert.ok(playerUi.text().includes('CURRENT LYRICS TEXT'), 'Lyrics must remain visible on audio error');

  // Transitioning to PLAYING must clear obsolete error notice
  ctrl.emitState('PLAYING');
  playerUi.render();
  assert.ok(!playerUi.text().includes('Audio decode failed'), 'Obsolete error notice must be cleared on PLAYING');

  // Open Songbook modal and test scoped error when reserve rejects
  let reserveShouldFail = false;
  ctrl.reserve = async () => {
    if (reserveShouldFail) throw new Error('Database busy');
  };

  const songbookBtn = playerUi.button('SONGBOOK');
  assert.ok(songbookBtn, 'Songbook button must exist');
  songbookBtn.props.onPress();
  playerUi.render();

  // Test Reserve failure scoped to modal
  reserveShouldFail = true;
  const songList = [{ code: '000002', title: 'Test 2', artist: 'Artist 2', has_singable_lyrics: 1 }];
  const songbookModal = playerUi.find('Modal', { visible: true })[0];
  assert.ok(songbookModal, 'Songbook modal must be visible');

  // Trigger reserve with failure
  const flatList = playerUi.find('FlatList')[0];
  const renderedItem = flatList.props.renderItem({ item: songList[0] });
  const reserveBtn = findNodes(renderedItem, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Reserve'))[0];
  assert.ok(reserveBtn, 'Must find reserve button');

  await reserveBtn.props.onPress();
  playerUi.render();
  assert.ok(playerUi.text().includes('Database busy'), 'Error must be displayed in modal on failed reserve');

  // Dismiss modal error
  const dismissModalBtn = playerUi.button('Dismiss');
  assert.ok(dismissModalBtn, 'Dismiss button must be present in modal error');
  dismissModalBtn.props.onPress();
  playerUi.render();
  assert.ok(!playerUi.text().includes('Database busy'), 'Dismiss button must clear modal error');

  // Test rapid reserve: timer generation prevents early wipe
  env.fakeTimers.advanceTimersByTime(600); // advance past 500ms debounce window
  reserveShouldFail = false;
  await reserveBtn.props.onPress();
  playerUi.render();
  assert.ok(playerUi.text().includes('Test 2 Reserved'), 'First reservation feedback displayed');

  // Second reserve 1000ms later
  env.fakeTimers.advanceTimersByTime(1000);
  const secondItem = { code: '000003', title: 'Test 3', artist: 'Artist 3', has_singable_lyrics: 1 };
  const renderedSecond = flatList.props.renderItem({ item: secondItem });
  const reserveBtn2 = findNodes(renderedSecond, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Reserve'))[0];
  await reserveBtn2.props.onPress();
  playerUi.render();
  assert.ok(playerUi.text().includes('Test 3 Reserved'), 'Second reservation feedback displayed');

  // Advance by another 1600ms (total 2600ms from first reserve). First timer fired at 2500ms.
  // Second feedback must NOT be wiped!
  env.fakeTimers.advanceTimersByTime(1600);
  playerUi.render();
  assert.ok(playerUi.text().includes('Test 3 Reserved'), 'Second reservation feedback must survive first timer expiration');

  // Advance by another 1000ms (total 2600ms from second reserve). Second feedback cleared.
  env.fakeTimers.advanceTimersByTime(1000);
  playerUi.render();
  assert.ok(!playerUi.text().includes('Test 3 Reserved'), 'Feedback clears after full 2500ms from second reserve');

  // Verify instrumental song rendering and eligibility (T05 / F17)
  const instrumentalItem = { code: '000004', title: 'Instrumental Song', artist: 'Artist 4', has_singable_lyrics: 0 };
  const renderedInst = flatList.props.renderItem({ item: instrumentalItem });
  const instText = extractText(renderedInst);
  assert.ok(instText.includes('Instrumental track (no lyrics)'), 'Instrumental track must display indicator');
  const instReserveBtn = findNodes(renderedInst, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Reserve'))[0];
  assert.ok(instReserveBtn, 'Instrumental track must have Reserve button');

  // Test pagination and stale query cancellation (T06 / F02, F12)
  const songDao = env.loadModule('src/db/songDao.ts').SongDao;
  let searchCalls = [];
  songDao.search = async (q, limit, offset) => {
    searchCalls.push({ q, limit, offset });
    const batch = [];
    for (let i = 0; i < limit; i++) {
      const num = String(offset + i + 1).padStart(6, '0');
      batch.push({ code: num, title: `Song ${num}`, artist: 'Artist', has_singable_lyrics: 1 });
    }
    return batch;
  };

  // Trigger search input
  const searchInput = playerUi.find('TextInput')[0];
  assert.ok(searchInput, 'Must find search input');

  // Trigger search with query that returns 50 items
  searchInput.props.onChangeText('browse50');
  playerUi.render(); // runs effect registering debounce timer
  env.fakeTimers.advanceTimersByTime(250); // timer fires setDebouncedQuery
  playerUi.render(); // runs effect calling loadSongs('browse50')
  for (let i = 0; i < 30; i++) await Promise.resolve();
  playerUi.render(); // sets songList (50 items) and hasMoreSongs (true)

  const paginatedList = playerUi.find('FlatList')[0];
  assert.ok(typeof paginatedList.props.onEndReached === 'function', 'FlatList must have onEndReached handler');
  await paginatedList.props.onEndReached();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.ok(searchCalls.some((c) => c.limit === 50 && c.offset === 50), 'Must query next 50 rows on onEndReached');

  // Test guarded actions and keyboard dismissal (T07 / F15, F16)
  let keyboardDismissCount = 0;
  env.reactNative.Keyboard.dismiss = () => { keyboardDismissCount++; };

  let playNowCount = 0;
  ctrl.playNow = async () => {
    playNowCount++;
    await new Promise((r) => setTimeout(r, 50));
  };

  const itemA = { code: '000101', title: 'Song A', artist: 'Artist A', has_singable_lyrics: 1 };
  const renderedItemA = paginatedList.props.renderItem({ item: itemA });
  const playBtnA = findNodes(renderedItemA, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Play'))[0];
  assert.ok(playBtnA, 'Must find Play button on song row');

  // Same-render rapid double tap on Play
  const p1 = playBtnA.props.onPress();
  const p2 = playBtnA.props.onPress();
  await Promise.all([p1, p2]);

  assert.equal(playNowCount, 1, 'Rapid double Play tap must only invoke playNow once');
  assert.ok(keyboardDismissCount > 0, 'Keyboard.dismiss must be called synchronously on Play');

  // Test Reserve double-tap gate and distinct songs
  let reservedCodes = [];
  ctrl.reserve = async (code) => {
    reservedCodes.push(code);
    await new Promise((r) => setTimeout(r, 20));
  };

  const reserveBtnA = findNodes(renderedItemA, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Reserve'))[0];
  assert.ok(reserveBtnA, 'Must find Reserve button on item A');

  // Same-render double tap on item A
  const rA1 = reserveBtnA.props.onPress();
  const rA2 = reserveBtnA.props.onPress();
  await Promise.all([rA1, rA2]);
  assert.equal(reservedCodes.filter((c) => c === '000101').length, 1, 'Same-song double tap must only reserve once');

  // Distinct song B can be reserved
  const itemB = { code: '000102', title: 'Song B', artist: 'Artist B', has_singable_lyrics: 1 };
  const renderedItemB = paginatedList.props.renderItem({ item: itemB });
  const reserveBtnB = findNodes(renderedItemB, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Reserve'))[0];
  await reserveBtnB.props.onPress();
  assert.ok(reservedCodes.includes('000102'), 'Distinct song B must be allowed');

  // Verify TalkBack accessibility roles and labels (T09 / F05)
  const stopButton = playerUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Stop')[0];
  assert.ok(stopButton, 'Stop button must have role button and label Stop');

  const songbookCloseBtn = playerUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Close')[0];
  assert.ok(songbookCloseBtn, 'Songbook modal close button must have role button and label Close');

  const songRowPlayBtn = findNodes(renderedItemB, (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Play Song B')[0];
  assert.ok(songRowPlayBtn, 'Song row Play button must have accessible name');
  assert.ok(extractText(renderedItemB).includes('[000102]'), 'Song row must display formatted song code');
  const songRowTitleText = findNodes(renderedItemB, (n) => n.type === 'Text' && extractText(n).includes('Song B'))[0];
  assert.equal(songRowTitleText?.props?.numberOfLines, 2, 'Portrait song title must allow 2 lines to prevent truncation');

  // Songbook modal container safe-area edges (Section 3, 4, 8)
  const songbookModalNode = playerUi.find('Modal')[0];
  assert.equal(songbookModalNode.props?.statusBarTranslucent, true, 'Songbook modal must be statusBarTranslucent for edge-to-edge layout');
  const songbookSafeArea = playerUi.find('SafeAreaView')[1];
  assert.ok(Array.isArray(songbookSafeArea.props.edges) && songbookSafeArea.props.edges.length === 0, 'Songbook SafeAreaView must pass edges=[] to disable native additive inset doubling');

  // Verify B18: SettingsModal statusBarTranslucent
  assert.equal(settingsDev.find('Modal')[0]?.props?.statusBarTranslucent, true, 'SettingsModal must set statusBarTranslucent=true');

  // Verify complete song identity fallback (T10 / F19)
  const transitionCtrl = createTestController();
  transitionCtrl.getActiveSong = () => null;
  transitionCtrl.getActiveReservation = () => ({ reservation_id: 99, song_code: '000042', title: 'Transition Song', artist: 'Transit Artist' });
  const transitionUi = env.mountUi(PlayerScreen, { controller: transitionCtrl });
  assert.ok(transitionUi.text().includes('[000042]'), 'Must render active reservation song code when activeSong is loading');
  assert.ok(transitionUi.text().includes('Transition Song'), 'Must render active reservation title when activeSong is loading');
  assert.ok(transitionUi.text().includes('Transit Artist'), 'Must render active reservation artist when activeSong is loading');
  transitionUi.unmount();

  // Root container insets (T10 / R01, R05)
  const rootSafeArea = playerUi.find('SafeAreaView')[0];
  const rootStyle = rootSafeArea?.props?.style;
  const flatRootStyle = Array.isArray(rootStyle) ? Object.assign({}, ...rootStyle.filter(Boolean)) : rootStyle;
  assert.ok(flatRootStyle.paddingTop >= 24, 'SafeAreaView must have dynamic insets from react-native-safe-area-context (R01)');
  assert.ok(Array.isArray(rootSafeArea.props.edges) && rootSafeArea.props.edges.length === 0, 'SafeAreaView must pass edges=[] to disable native additive inset doubling');

  playerUi.unmount();

  // Verify dedicated two-column Landscape layout (Section 5 / Section 13)
  const landscapeEnv = createUiEnvironment({ windowDimensions: { width: 812, height: 375 } });
  const LandscapePlayerScreen = landscapeEnv.loadModule('src/screens/Player.tsx').PlayerScreen;
  const landscapeCtrl = createTestController();
  landscapeCtrl.getState = () => 'PLAYING';
  landscapeCtrl.getActiveSong = () => ({
    code: '026771',
    title: "'Di Ko Na Mapipigilan",
    artist: 'Sex Bomb Girls',
  });
  landscapeCtrl.getTotalTimeMs = () => 225000;
  const landscapeUi = landscapeEnv.mountUi(LandscapePlayerScreen, { controller: landscapeCtrl });

  // 1. Must render transport controls and navigation actions
  const lStop = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Stop')[0];
  assert.ok(lStop, 'Landscape must render accessible Stop button');
  const stopTextNode = findNodes(lStop, (n) => n.type === 'Text')[0];
  assert.equal(stopTextNode?.props?.numberOfLines, 1, 'Stop button text must have numberOfLines=1 to prevent wrapping');
  assert.ok(stopTextNode?.props?.maxFontSizeMultiplier <= 1.3, 'Stop button text must cap maxFontSizeMultiplier');

  const lPlay = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && (n.props?.accessibilityLabel === 'Pause' || n.props?.accessibilityLabel === 'Play'))[0];
  assert.ok(lPlay, 'Landscape must render accessible Play/Pause button');
  const playTextNode = findNodes(lPlay, (n) => n.type === 'Text')[0];
  assert.equal(playTextNode?.props?.numberOfLines, 1, 'Play button text must have numberOfLines=1 to prevent wrapping');

  const lNext = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Next')[0];
  assert.ok(lNext, 'Landscape must render accessible Next button');
  const nextTextNode = findNodes(lNext, (n) => n.type === 'Text')[0];
  assert.equal(nextTextNode?.props?.numberOfLines, 1, 'Next button text must have numberOfLines=1 to prevent wrapping');

  const lSongbook = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Songbook')[0];
  assert.ok(lSongbook, 'Landscape must render accessible Songbook button');
  const songbookTextNode = findNodes(lSongbook, (n) => n.type === 'Text')[0];
  assert.equal(songbookTextNode?.props?.numberOfLines, 1, 'Songbook button text must have numberOfLines=1 to prevent wrapping');

  // 2. Must render compact song metadata
  assert.ok(landscapeUi.text().includes('[026771]'), 'Landscape sidebar must render song code');
  assert.ok(landscapeUi.text().includes("'Di Ko Na Mapipigilan"), 'Landscape sidebar must render song title');
  assert.ok(landscapeUi.text().includes('Sex Bomb Girls'), 'Landscape sidebar must render song artist');

  // 3. Must render lyrics in main stage
  assert.ok(landscapeUi.text().includes('CURRENT LYRICS TEXT'), 'Landscape main column must render active lyrics');

  // 4. Test collapsible control panel in landscape (Section 2, 4, 6)
  const hideControlsBtn = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Hide controls')[0];
  assert.ok(hideControlsBtn, 'Expanded landscape must render Hide controls toggle button');

  // Trigger collapse
  hideControlsBtn.props.onPress();
  landscapeUi.render();

  // Verify collapsed state: sidebar controls hidden, expand button visible, lyrics retained
  const showControlsBtn = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Show controls')[0];
  assert.ok(showControlsBtn, 'Collapsed landscape must render Show controls toggle button');
  const collapsedStop = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Stop')[0];
  assert.ok(!collapsedStop, 'Control panel must be hidden in collapsed state');
  assert.ok(landscapeUi.text().includes('CURRENT LYRICS TEXT'), 'Lyrics stage must remain active in collapsed state');

  // Trigger expand
  showControlsBtn.props.onPress();
  landscapeUi.render();

  // Verify re-expanded state
  const reExpandedStop = landscapeUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Stop')[0];
  assert.ok(reExpandedStop, 'Controls must be restored upon expanding');

  landscapeUi.unmount();

  console.log('Player scoped error & lyric retention check: PASS');

  // Test QueueModal recovery, activeKeyOffset & distinct empty states (T04 / F06, F11, F13, F18)
  const QueueModal = env.loadModule('src/components/QueueModal.tsx').QueueModal;

  const item1 = {
    reservation_id: 101,
    song_code: '000001',
    reserved_at: Date.now(),
    status: 'pending',
    key_offset: 0,
    title: 'Pending Song 1',
    artist: 'Artist 1',
  };

  let restoreAttempts = 0;
  let restoreShouldFail = true;

  const queueUi = env.mountUi(QueueModal, {
    visible: true,
    onClose: () => {},
    activeReservation: {
      reservation_id: 1,
      song_code: '000099',
      reserved_at: Date.now(),
      status: 'active',
      key_offset: 0, // stale snapshot in reservation
      title: 'Active Song',
      artist: 'Active Artist',
    },
    pendingQueue: [item1],
    onRemovePending: async () => item1,
    onRestorePending: async () => {
      restoreAttempts++;
      if (restoreShouldFail) throw new Error('Database locked');
    },
    language: 'en',
    activeKeyOffset: 3, // Live key from Player is +3!
  });

  // 1. Live key badge must reflect activeKeyOffset (+3), not stale 0
  assert.ok(queueUi.text().includes('+3'), 'Queue must display live activeKeyOffset (+3)');

  // 2. Remove pending item
  const queueFlatList = queueUi.find('FlatList')[0];
  assert.ok(queueFlatList, 'Must find FlatList in QueueModal');
  const renderedQueueItem = queueFlatList.props.renderItem({ item: item1, index: 0 });
  const removeBtn = findNodes(renderedQueueItem, (n) => n.type === 'TouchableOpacity' && extractText(n).includes('Remove'))[0];
  assert.ok(removeBtn, 'Must find remove button');
  await removeBtn.props.onPress();
  queueUi.render();

  // Undo banner must appear
  const undoBtn = queueUi.find('TouchableOpacity').find((n) => extractText(n).includes('UNDO') || extractText(n).includes('Undo'));
  assert.ok(undoBtn, 'Undo button must appear after removal');

  // 3. Trigger Undo while restore fails
  restoreShouldFail = true;
  await undoBtn.props.onPress();
  queueUi.render();

  // Must NOT lose undoItem and must show error
  assert.equal(restoreAttempts, 1);
  assert.ok(queueUi.text().includes('Database is busy') || queueUi.text().includes('Could not restore'), 'Restore error must be friendly mapped message');
  const retryBtn = queueUi.button('Retry');
  assert.ok(retryBtn, 'Retry button must be available after restore failure');

  // 4. Retry succeeds
  restoreShouldFail = false;
  await retryBtn.props.onPress();
  queueUi.render();
  assert.equal(restoreAttempts, 2);
  assert.ok(!queueUi.text().includes('Database is busy'), 'Error cleared after successful restore');

  // Verify QueueModal accessibility roles and labels (T09 / F05)
  const queueCloseBtn = queueUi.find((n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === 'Close')[0];
  assert.ok(queueCloseBtn, 'QueueModal close button must have role button and label Close');
  assert.equal(queueUi.find('Modal')[0]?.props?.statusBarTranslucent, true, 'QueueModal must set statusBarTranslucent=true');

  const renderedQueueRow = queueFlatList.props.renderItem({ item: item1, index: 0 });
  const rowRemoveBtn = findNodes(renderedQueueRow, (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel?.includes('Remove'))[0];
  assert.ok(rowRemoveBtn, 'Queue item remove button must have role button and label');

  // Verify U03 reorder buttons accessibility roles and labels
  const moveUpBtn = findNodes(renderedQueueRow, (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel?.includes('Move up'))[0];
  const moveDownBtn = findNodes(renderedQueueRow, (n) => n.props?.accessibilityLabel?.includes('Move down'))[0];
  assert.ok(moveUpBtn, 'Queue item Move up button must have role button and label');
  assert.ok(moveDownBtn, 'Queue item Move down button must have role button and label');
  assert.strictEqual(moveUpBtn.props.disabled, true, 'First item move up button must be disabled');

  queueUi.unmount();
  console.log('QueueModal recovery durability & live key check: PASS');

  // ==========================================
  // U09: Up Next Banner on Player Check
  // ==========================================
  const upNextCtrl = createTestController();
  upNextCtrl.getPendingQueue = () => [
    { reservation_id: 2, song_code: '000002', title: 'Next In Line' },
  ];
  const upNextUi = env.mountUi(PlayerScreen, { controller: upNextCtrl });
  upNextUi.render();
  assert.ok(upNextUi.text().includes('Up next: Next In Line'), 'Player must render Up next: [Title] when queue is non-empty');
  upNextUi.unmount();
  console.log('Player U09 Up Next check: PASS');

  // ==========================================
  // U10: Startup Failure Recovery & Retry Check
  // ==========================================
  const failCtrl = createTestController();
  failCtrl.getState = () => 'IDLE';
  failCtrl.getActiveSong = () => null;
  failCtrl.getActiveReservation = () => null;
  let initAttemptCount = 0;
  failCtrl.initializeAsync = async () => {
    initAttemptCount++;
    if (initAttemptCount === 1) {
      return { audioReady: false, catalogReady: false, totalSongs: 0, packFormatVersion: 1 };
    }
    return { audioReady: true, catalogReady: true, totalSongs: 47997, packFormatVersion: 1 };
  };
  const failUi = env.mountUi(PlayerScreen, { controller: failCtrl });
  failUi.render();

  // Give microtasks time to execute
  await new Promise((r) => setTimeout(r, 10));
  failUi.render();

  assert.ok(failUi.text().includes('Could not initialize audio engine and song catalog.'), 'Must display startup error');
  const retryInitBtn = failUi.button('Retry');
  assert.ok(retryInitBtn, 'Must render Retry button on startup failure');
  await retryInitBtn.props.onPress();
  await new Promise((r) => setTimeout(r, 10));
  failUi.render();

  assert.equal(initAttemptCount, 2, 'Retry must trigger initializeAsync again');
  assert.ok(!failUi.text().includes('Could not initialize audio engine'), 'Startup error cleared on successful retry');
  failUi.unmount();
  console.log('Player U10 Startup Retry check: PASS');

  // ==========================================
  // B19: Restore Default Orientation on Unmount Check
  // ==========================================
  let lastSetOrientation = null;
  const mockLibraryModule = env.loadModule('modules/kantahulay-library/index.ts').default;
  const origSetOrientation = mockLibraryModule.setScreenOrientation;
  mockLibraryModule.setScreenOrientation = (orient) => {
    lastSetOrientation = orient;
    return true;
  };
  const orientationPlayerCtrl = createTestController();
  const orientPlayerUi = env.mountUi(PlayerScreen, { controller: orientationPlayerCtrl });
  orientPlayerUi.render();
  orientPlayerUi.unmount();
  assert.equal(lastSetOrientation, 'unspecified', 'Leaving Player screen must restore default orientation (unspecified)');
  mockLibraryModule.setScreenOrientation = origSetOrientation;
  console.log('Player B19 Orientation Restore check: PASS');

  // ==========================================
  // B15: Empty/Missing Catalog Clarity Check
  // ==========================================
  const SongDao = env.loadModule('src/db/songDao.ts').SongDao;
  const originalSongDaoCount = SongDao.count;
  const originalSongDaoSearch = SongDao.search;
  SongDao.count = async () => 0;
  SongDao.search = async () => [];

  const emptyCatalogCtrl = createTestController();
  emptyCatalogCtrl.isCatalogReady = () => true;
  emptyCatalogCtrl.getTotalSongs = () => 0;
  emptyCatalogCtrl.initializeAsync = async () => ({
    audioReady: true,
    catalogReady: true,
    totalSongs: 0,
    packFormatVersion: 1,
  });

  const emptyCatalogUi = env.mountUi(PlayerScreen, { controller: emptyCatalogCtrl });
  emptyCatalogUi.render();
  await new Promise((r) => setTimeout(r, 10));
  emptyCatalogUi.render();

  // Open Songbook modal
  const openSongbookBtn = emptyCatalogUi.button('SONGBOOK');
  assert.ok(openSongbookBtn, 'Must find SONGBOOK button on Player');
  await openSongbookBtn.props.onPress();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  emptyCatalogUi.render();

  const emptyFlatList = emptyCatalogUi.find('FlatList')[0];
  assert.ok(emptyFlatList, 'Must find FlatList in open Songbook modal');
  const renderedEmpty = emptyFlatList.props.ListEmptyComponent;
  const emptyText = renderedEmpty ? extractText(renderedEmpty) : '';

  assert.ok(
    emptyText.includes('Song catalog is empty or missing.') || emptyCatalogUi.text().includes('Song catalog is empty or missing.'),
    'Must display clear message when catalog is empty/missing instead of hanging on Syncing catalog'
  );
  emptyCatalogUi.unmount();
  SongDao.count = originalSongDaoCount;
  SongDao.search = originalSongDaoSearch;
  console.log('Player B15 Empty Catalog check: PASS');

  // ==========================================
  // Onboarding & Tutorial Reopen Check
  // ==========================================
  const OnboardingModal = env.loadModule('src/components/OnboardingModal.tsx').OnboardingModal;

  let onboardingCompleted = null;
  const onboardingUi = env.mountUi(OnboardingModal, {
    visible: true,
    onClose: (c) => { onboardingCompleted = c; },
    totalSongs: 47997,
    isTutorialMode: false,
  });
  onboardingUi.render();

  // Single-Page Minimalist Onboarding View
  assert.ok(onboardingUi.text().includes('Welcome to Kantahulay'), 'Hero welcome title must be present');
  assert.ok(onboardingUi.text().includes('Your Karaoke, Anytime.'), 'Hero subtitle must be present');
  assert.ok(onboardingUi.text().includes('Sing your favorite songs, even offline.'), 'Hero description must be present');
  assert.ok(onboardingUi.text().includes('KANTAHULAY'), 'Brand name must be present');
  assert.ok(onboardingUi.text().includes('40,000+ songs in offline library'), 'Catalog count must reflect 40,000+ songs');

  const logoNode = onboardingUi.find((n) => n.type === 'Image' && n.props?.accessibilityLabel === 'Kantahulay Logo')[0];
  assert.ok(logoNode, 'Must render official Kantahulay logo asset');

  // Feature Highlights on Single Page
  assert.ok(onboardingUi.text().includes('Find Your Song'), 'Feature 1 title must be present');
  assert.ok(onboardingUi.text().includes('Search. Queue. Sing.'), 'Feature 1 subtitle must be present');
  assert.ok(onboardingUi.text().includes('Browse the Songbook, choose a song, and add it to your queue.'), 'Feature 1 description must be present');

  assert.ok(onboardingUi.text().includes('Real Videoke Stage'), 'Feature 2 title must be present');
  assert.ok(onboardingUi.text().includes('Real-time lyrics & vocal timing.'), 'Feature 2 subtitle must be present');
  assert.ok(onboardingUi.text().includes('Follow synchronized syllable sweeps with a 4-dot entry meter.'), 'Feature 2 description must be present');

  assert.ok(onboardingUi.text().includes('Sing Your Way'), 'Feature 3 title must be present');
  assert.ok(onboardingUi.text().includes('Portrait or Landscape. Your Choice.'), 'Feature 3 subtitle must be present');
  assert.ok(onboardingUi.text().includes('Follow the lyrics, adjust the key, and enjoy karaoke your way.'), 'Feature 3 description must be present');

  const startSingingBtn = onboardingUi.button('Start Singing');
  assert.ok(startSingingBtn, 'Start Singing button must be present');
  const skipBtn = onboardingUi.button('Skip tutorial');
  assert.ok(skipBtn, 'Skip button must be present');

  // Complete onboarding via Start Singing
  env.fakeTimers.advanceTimersByTime(300);
  startSingingBtn.props.onPress();
  assert.equal(onboardingCompleted, true, 'Start Singing must complete onboarding and invoke onClose(true)');
  onboardingUi.unmount();

  // Test Skip flow on Screen 1
  let skipCompleted = null;
  const skipUi = env.mountUi(OnboardingModal, {
    visible: true,
    onClose: (c) => { skipCompleted = c; },
    isTutorialMode: false,
  });
  skipUi.render();
  const directSkipBtn = skipUi.button('Skip tutorial');
  assert.ok(directSkipBtn, 'Skip tutorial button must exist');
  env.fakeTimers.advanceTimersByTime(300);
  directSkipBtn.props.onPress();
  assert.equal(skipCompleted, true, 'Skip on Screen 1 must complete and invoke onClose(true)');
  skipUi.unmount();

  // Test Settings Reopen Tutorial option
  let tutorialOpened = false;
  const settingsTutorialUi = env.mountUi(SettingsModal, {
    visible: true,
    onClose: () => {},
    language: 'en',
    onLanguageChange: () => {},
    theme: 'dark',
    totalSongs: 100,
    packFormatVersion: 1,
    onViewTutorial: () => { tutorialOpened = true; },
  });
  settingsTutorialUi.render();

  const viewTutorialBtn = settingsTutorialUi.button('View Tutorial');
  assert.ok(viewTutorialBtn, 'SettingsModal must have View Tutorial button');
  viewTutorialBtn.props.onPress();
  assert.equal(tutorialOpened, true, 'Clicking View Tutorial must call onViewTutorial');
  settingsTutorialUi.unmount();

  // Test Landscape Layout adaptability
  const onboardingLandscapeEnv = createUiEnvironment({
    windowDimensions: { width: 812, height: 375 },
    safeAreaInsets: { top: 0, right: 32, bottom: 16, left: 32 },
  });
  const LandscapeOnboardingModal = onboardingLandscapeEnv.loadModule('src/components/OnboardingModal.tsx').OnboardingModal;
  const landscapeOnboarding = onboardingLandscapeEnv.mountUi(LandscapeOnboardingModal, {
    visible: true,
    onClose: () => {},
    totalSongs: 500,
  });
  landscapeOnboarding.render();
  assert.ok(landscapeOnboarding.text().includes('Welcome to Kantahulay'), 'Landscape must render Screen 1 properly');
  landscapeOnboarding.unmount();

  console.log('Onboarding 1-page flow & Settings reopen check: PASS');

  // ==========================================
  // App Fresh-Install Onboarding Gate Check
  // ==========================================
  let resolveOnboardingPromise;
  const mockOnboardingPromise = new Promise((resolve) => {
    resolveOnboardingPromise = resolve;
  });

  const appEnv = createUiEnvironment();
  const mockSettingsDao = {
    SettingsDao: {
      isOnboardingCompleted: () => mockOnboardingPromise,
      setOnboardingCompleted: async () => {},
    },
  };

  const App = appEnv.loadModule('App.tsx', {
    './src/db/settingsDao': mockSettingsDao,
  }).default;

  const appUi = appEnv.mountUi(App);
  appUi.render();

  // 1. On cold launch before check resolves, PlayerScreen must NOT be mounted
  assert.notStrictEqual(
    appUi.tree?.props?.children?.type?.name,
    'PlayerScreen',
    'App must not render PlayerScreen before onboarding completion check resolves'
  );

  // 2. Resolve as fresh install (onboarding not completed)
  resolveOnboardingPromise(false);
  await appUi.flushEffects();

  // Fresh install must render OnboardingContent directly — PlayerScreen is NOT mounted!
  const hasOnboardingContent = appUi.find((el) => el?.type?.name === 'OnboardingContent').length > 0;
  const hasPlayerScreen = appUi.find((el) => el?.type?.name === 'PlayerScreen').length > 0;
  assert.ok(hasOnboardingContent, 'Fresh install must render OnboardingContent directly');
  assert.strictEqual(hasPlayerScreen, false, 'PlayerScreen must NOT be mounted during onboarding');

  // 3. Complete onboarding from OnboardingContent
  const onboardingElement = appUi.find((el) => el?.type?.name === 'OnboardingContent')[0];
  onboardingElement.props.onClose();
  await appUi.flushEffects();

  // Now PlayerScreen must be mounted
  const mountedPlayerAfterOnboarding = appUi.find((el) => el?.type?.name === 'PlayerScreen').length > 0;
  assert.ok(mountedPlayerAfterOnboarding, 'PlayerScreen must mount after onboarding is dismissed');

  appUi.unmount();

  // 4. Verify existing install resolves with PlayerScreen immediately (no OnboardingContent)
  mockSettingsDao.SettingsDao.isOnboardingCompleted = async () => true;
  const existingAppUi = appEnv.mountUi(App);
  await existingAppUi.flushEffects();
  const existingHasPlayerScreen = existingAppUi.find((el) => el?.type?.name === 'PlayerScreen').length > 0;
  const existingHasOnboarding = existingAppUi.find((el) => el?.type?.name === 'OnboardingContent').length > 0;
  assert.ok(existingHasPlayerScreen, 'Existing install must mount PlayerScreen immediately');
  assert.strictEqual(existingHasOnboarding, false, 'Existing install must NOT render OnboardingContent');
  existingAppUi.unmount();

  console.log('App fresh-install onboarding gate check: PASS');
}

if (require.main === module) {
  runHarnessContractTests().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  createUiEnvironment,
  extractText,
  findNodes,
  runHarnessContractTests,
};
