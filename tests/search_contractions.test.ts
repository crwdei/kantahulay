import { setupTestEnvironment } from './testDbAdapter';
import { SongDao } from '../src/db/songDao';
import { getDatabaseAsync } from '../src/db/database';

describe('U02: Contraction Search & Normalization', () => {
  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.execAsync(`DELETE FROM songs;`);

    // Insert songs with various forms in search_key
    await db.runAsync(`
      INSERT INTO songs (code, title, artist, search_key, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256)
      VALUES
        ('000001', 'Can''t Buy Me Love', 'The Beatles', 'cant buy me love the beatles', 1000, 1, 16, 100, 200, 'h1'),
        ('000002', 'Can T Stop', 'Red Hot Chili Peppers', 'can t stop red hot chili peppers', 1000, 1, 116, 100, 200, 'h2'),
        ('000003', 'Highway to Hell', 'AC/DC', 'highway to hell ac dc', 1000, 1, 216, 100, 200, 'h3'),
        ('000004', 'He''ll Have to Go', 'Jim Reeves', 'he ll have to go jim reeves', 1000, 1, 316, 100, 200, 'h4'),
        ('000005', 'Don''t Stop Believin', 'Journey', 'dont stop believin journey', 1000, 1, 416, 100, 200, 'h5'),
        ('000006', 'Don T Cry', 'Guns N Roses', 'don t cry guns n roses', 1000, 1, 516, 100, 200, 'h6');
    `);
  });

  test('can-t search matches both "cant" and "can t" songs', async () => {
    const results = await SongDao.search("can't");
    const codes = results.map((r) => r.code);
    expect(codes).toContain('000001');
    expect(codes).toContain('000002');
  });

  test('cant matches both "cant" and "can t" songs', async () => {
    const results = await SongDao.search('cant');
    const codes = results.map((r) => r.code);
    expect(codes).toContain('000001');
    expect(codes).toContain('000002');
  });

  test('dont search matches both "dont" and "don t" songs', async () => {
    const r1 = await SongDao.search("don't");
    expect(r1.map((s) => s.code)).toEqual(expect.arrayContaining(['000005', '000006']));

    const r2 = await SongDao.search('dont');
    expect(r2.map((s) => s.code)).toEqual(expect.arrayContaining(['000005', '000006']));
  });

  test('hell matches "hell" exactly and is never split into "he ll"', async () => {
    const results = await SongDao.search('hell');
    const codes = results.map((r) => r.code);
    expect(codes).toContain('000003'); // Highway to Hell
    expect(codes).not.toContain('000004'); // He'll Have to Go
  });

  test.each(['dont cry', "don't cry", 'don’t cry'])('whole phrase %s matches legacy spaced keys', async (query) => {
    expect((await SongDao.search(query)).map((song) => song.code)).toContain('000006');
  });

  test('he-ll search matches "he ll"', async () => {
    const results = await SongDao.search("he'll");
    const codes = results.map((r) => r.code);
    expect(codes).toContain('000004');
  });

  test('U06: song code search matches prefixes and sorts exact matches first', async () => {
    const db = await getDatabaseAsync();
    await db.runAsync(`
      INSERT INTO songs (code, title, artist, search_key, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256)
      VALUES
        ('014200', 'Prefix Match Song A', 'Artist A', 'prefix match song a', 1000, 1, 616, 100, 200, 'h7'),
        ('014299', 'Prefix Match Song B', 'Artist B', 'prefix match song b', 1000, 1, 716, 100, 200, 'h8'),
        ('000142', 'Padded Exact Song', 'Artist C', 'padded exact song', 1000, 1, 816, 100, 200, 'h9');
    `);

    // Search by prefix "0142"
    const results = await SongDao.search('0142');
    const codes = results.map((r) => r.code);

    // Should include both prefix matches starting with 0142, and padded exact match 000142
    expect(codes).toContain('014200');
    expect(codes).toContain('014299');
    expect(codes).toContain('000142');

    // Searching exact 6-digit code "014200" must sort 014200 first
    const exactResults = await SongDao.search('014200');
    expect(exactResults[0].code).toBe('014200');

    // Searching "142" with padded match "000142" should prioritize exact padded code
    const paddedResults = await SongDao.search('142');
    expect(paddedResults[0].code).toBe('000142');
  });
});
