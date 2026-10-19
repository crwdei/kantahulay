const { createPlayer, deferred, settle } = require('./player-test-helpers.cjs');

const song = (code: string) => ({ code, title: `Song ${code}`, has_singable_lyrics: 1 });

describe('B10: production Player search callbacks', () => {
  test('input invalidates pending search before debounce and only latest response applies', async () => {
    const p = createPlayer();
    const requests: { query: string; result: ReturnType<typeof deferred> }[] = [];
    p.songDao.search = (query: string) => {
      const result = deferred();
      requests.push({ query, result });
      return result.promise;
    };
    p.open();
    p.input('beatles');
    // Resolve old browse while new input is still inside its 200 ms debounce.
    requests[0].result.resolve([song('old-browse')]);
    await settle();
    p.ui.render();
    expect(p.list().props.data).toEqual([]);
    p.debounce();
    expect(requests[1].query).toBe('beatles');
    p.input('queen');
    p.debounce();
    requests[2].result.resolve([song('queen')]);
    await settle();
    p.ui.render();
    requests[1].result.resolve([song('beatles')]);
    await settle();
    p.ui.render();
    expect(p.list().props.data.map((s: any) => s.code)).toEqual(['queen']);
    p.ui.unmount();
  });

  test('stale pagination releases loading gate and cannot append into new query', async () => {
    const p = createPlayer();
    const firstPage = Array.from({ length: 50 }, (_, i) => song(`a${i}`));
    const nextPage = Array.from({ length: 50 }, (_, i) => song(`b${i}`));
    const stale = deferred();
    const search = jest.fn((query: string, _limit: number, offset: number) => {
      if (offset > 0) return query === '' ? stale.promise : Promise.resolve([song('b50')]);
      return Promise.resolve(query === '' ? firstPage : nextPage);
    });
    p.songDao.search = search;
    p.open();
    await settle();
    p.ui.render();
    const pending = p.list().props.onEndReached();
    p.ui.render();
    p.input('new query');
    p.debounce();
    await settle();
    p.ui.render();
    stale.resolve([song('stale-page')]);
    await pending;
    p.ui.render();
    expect(p.list().props.data.map((s: any) => s.code)).toEqual(nextPage.map(s => s.code));
    await p.list().props.onEndReached();
    p.ui.render();
    expect(search).toHaveBeenCalledWith('new query', 50, 50);
    expect(p.list().props.data).toHaveLength(51);
    p.ui.unmount();
  });

  test('unmount invalidates outstanding query without state writes', async () => {
    const p = createPlayer();
    await settle();
    const pending = deferred();
    p.songDao.search = () => pending.promise;
    p.open();
    p.ui.unmount();
    pending.resolve([song('late')]);
    await settle();
    expect(p.ui.updatesAfterUnmount).toBe(0);
  });

  test('pagination ignores repeated same-render end events', async () => {
    const p = createPlayer();
    const pending = deferred();
    const search = jest.fn((_q: string, _limit: number, offset: number) => offset
      ? pending.promise : Promise.resolve(Array.from({ length: 50 }, (_, i) => song(`${i}`))));
    p.songDao.search = search;
    p.open();
    await settle();
    p.ui.render();
    const onEndReached = p.list().props.onEndReached;
    const first = onEndReached();
    const duplicate = onEndReached();
    expect(search.mock.calls.filter((args: any[]) => args[2] === 50)).toHaveLength(1);
    pending.resolve([]);
    await Promise.all([first, duplicate]);
    p.ui.unmount();
  });

  test('typing then clearing within one debounce still loads current query', async () => {
    const p = createPlayer();
    const stale = deferred();
    const search = jest.fn().mockReturnValueOnce(stale.promise).mockResolvedValue([song('current')]);
    p.songDao.search = search;
    p.open();
    p.input('temporary');
    p.input('');
    p.debounce();
    await settle();
    stale.resolve([song('stale')]);
    await settle();
    p.ui.render();
    expect(p.list().props.data.map((s: any) => s.code)).toEqual(['current']);
    p.ui.unmount();
  });

  test('query rejection clears previous visible list and allows retry', async () => {
    const p = createPlayer();
    p.songDao.search = async () => [song('old')];
    p.open();
    await settle();
    p.ui.render();
    expect(p.list().props.data).toHaveLength(1);
    p.songDao.search = async () => { throw new Error('Database disk I/O failure'); };
    p.input('broken');
    p.debounce();
    await settle();
    p.ui.render();
    expect(p.list().props.data).toEqual([]);
    p.songDao.search = async () => [song('recovered')];
    p.input('retry');
    p.debounce();
    await settle();
    p.ui.render();
    expect(p.list().props.data.map((s: any) => s.code)).toEqual(['recovered']);
    p.ui.unmount();
  });
});
