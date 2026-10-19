export type SupportedLanguage = 'en' | 'fil' | 'ceb';

export interface Translations {
  app_name: string;
  songbook: string;
  search_placeholder: string;
  enter_code: string;
  code_keypad: string;
  reserve: string;
  reserved: string;
  starts_now: string;
  queue: string;
  now_playing: string;
  pending_queue: string;
  queue_empty: string;
  remove: string;
  undo: string;
  song_removed: string;
  settings: string;
  language: string;
  theme: string;
  library_info: string;
  library_offline_badge: string;
  pack_version: string;
  entry_count: string;
  rights_notice: string;
  device_baseline: string;
  close: string;
  clear: string;
  backspace: string;
  song_not_found: string;
  did_you_mean: string;
  instrumental_only: string;
  key: string;
  play: string;
  pause: string;
  stop: string;
  next: string;
  waiting_play: string;
  loading: string;
  error: string;
  select_song_prompt: string;
  dismiss: string;
  retry: string;
  could_not_reserve: string;
  could_not_play: string;
  no_active_song: string;
  no_upcoming_songs: string;
  queue_needs_refresh: string;
  reload: string;
  restore_failed: string;
}

export const DICTIONARIES: Record<SupportedLanguage, Translations> = {
  en: {
    app_name: 'Kantahulay',
    songbook: 'Songbook',
    search_placeholder: 'Search title or artist...',
    enter_code: 'Enter 6-digit code',
    code_keypad: 'Numeric Keypad',
    reserve: 'Reserve',
    reserved: 'Reserved',
    starts_now: 'Starts Now',
    queue: 'Queue',
    now_playing: 'Now Playing',
    pending_queue: 'Up Next',
    queue_empty: 'No songs in queue',
    remove: 'Remove',
    undo: 'Undo',
    song_removed: 'Removed from queue',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    library_info: 'Bundled Library Info',
    library_offline_badge: '100% Offline · Built-in Library',
    pack_version: 'Pack Format Version',
    entry_count: 'Total Songs',
    rights_notice: 'Community MIDI karaoke catalog.',
    device_baseline: 'Target: Android 10+ · 4 GB Physical RAM · ARM64-v8a',
    close: 'Close',
    clear: 'Clear',
    backspace: 'Del',
    song_not_found: 'Song code not in catalog',
    did_you_mean: 'Did you mean...',
    instrumental_only: 'Instrumental track (no lyrics)',
    key: 'KEY',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    next: 'Next',
    waiting_play: 'Press Play to start',
    loading: 'Loading song...',
    error: 'Audio error',
    select_song_prompt: 'Select a song or enter a code to begin',
    dismiss: 'Dismiss',
    retry: 'Retry',
    could_not_reserve: 'Could not reserve song',
    could_not_play: 'Could not play song',
    no_active_song: 'No song currently playing',
    no_upcoming_songs: 'No upcoming songs reserved',
    queue_needs_refresh: 'Queue out of date',
    reload: 'Reload',
    restore_failed: 'Could not restore song',
  },
  fil: {
    app_name: 'Kantahulay',
    songbook: 'Aklat ng Kanta',
    search_placeholder: 'Maghanap ng pamagat o mang-aawit...',
    enter_code: 'Ilagay ang 6-digit na kodigo',
    code_keypad: 'Numerikong Keypad',
    reserve: 'Ireserba',
    reserved: 'Nareserba na',
    starts_now: 'Magsisimula Agad',
    queue: 'Pila',
    now_playing: 'Kasalukuyang Tumutugtog',
    pending_queue: 'Mga Susunod na Kanta',
    queue_empty: 'Walang kanta sa pila',
    remove: 'Alisin',
    undo: 'Ibalik',
    song_removed: 'Inalis sa pila',
    settings: 'Mga Setting',
    language: 'Wika',
    theme: 'Tema',
    library_info: 'Impormasyon ng Nakapaloob na Library',
    library_offline_badge: '100% Offline · Nakapaloob na Koleksyon',
    pack_version: 'Bersyon ng Format ng Pakete',
    entry_count: 'Kabuuang Kanta',
    rights_notice: 'Koleksyon ng MIDI videoke mula sa komunidad.',
    device_baseline: 'Target: Android 10+ · 4 GB Physical RAM · ARM64-v8a',
    close: 'Isara',
    clear: 'Burahin',
    backspace: 'Bawas',
    song_not_found: 'Hindi nahanap ang kodigo ng kanta',
    did_you_mean: 'Ito ba ang ibig mong sabihin...',
    instrumental_only: 'Instrumental lamang (walang titik)',
    key: 'TONO',
    play: 'Tugtugin',
    pause: 'Itigil Sandali',
    stop: 'Huminto',
    next: 'Susunod',
    waiting_play: 'Pindutin ang Play para simulan',
    loading: 'Ikinakarga ang kanta...',
    error: 'May aberya sa tugtog',
    select_song_prompt: 'Pumili ng kanta o maglagay ng kodigo upang magsimula',
    dismiss: 'Ibalewala',
    retry: 'Subukan Muli',
    could_not_reserve: 'Hindi maipila ang kanta',
    could_not_play: 'Hindi matugtog ang kanta',
    no_active_song: 'Walang kasalukuyang tumutugtog',
    no_upcoming_songs: 'Walang nakareserbang susunod na kanta',
    queue_needs_refresh: 'Hindi updated ang pila',
    reload: 'I-reload',
    restore_failed: 'Hindi maibalik ang kanta',
  },
  ceb: {
    app_name: 'Kantahulay',
    songbook: 'Basahon sa Kanta',
    search_placeholder: 'Pangitaa ang titulo o mag-aawit...',
    enter_code: 'Ibutang ang 6-digit nga kodigo',
    code_keypad: 'Numero nga Keypad',
    reserve: 'I-reserba',
    reserved: 'Nareserba na',
    starts_now: 'Magsugod Karon',
    queue: 'Linya',
    now_playing: 'Karon Gitugtog',
    pending_queue: 'Mga Sunod nga Kanta',
    queue_empty: 'Walay kanta sa linya',
    remove: 'Tangtanga',
    undo: 'Ibalik',
    song_removed: 'Gikuha gikan sa linya',
    settings: 'Mga Setting',
    language: 'Pinulongan',
    theme: 'Tema',
    library_info: 'Impormasyon sa Gilakip nga Library',
    library_offline_badge: '100% Offline · Gilakip nga Koleksyon',
    pack_version: 'Bersyon sa Format sa Pakete',
    entry_count: 'Tanan nga Kanta',
    rights_notice: 'Koleksyon sa MIDI videoke alang sa komunidad.',
    device_baseline: 'Target: Android 10+ · 4 GB Physical RAM · ARM64-v8a',
    close: 'Sirad-i',
    clear: 'Papasa',
    backspace: 'Itras',
    song_not_found: 'Wala makit-i ang kodigo sa kanta',
    did_you_mean: 'Mao ba kini imong gipasabot...',
    instrumental_only: 'Instrumental lamang (walay liriko)',
    key: 'TONO',
    play: 'Tugtoga',
    pause: 'Paundangi',
    stop: 'Hunong',
    next: 'Sunod',
    waiting_play: 'Pislita ang Play aron magsugod',
    loading: 'Gikarga ang kanta...',
    error: 'Sayop sa audio',
    select_song_prompt: 'Pagpili og kanta o pagbutang og kodigo aron magsugod',
    dismiss: 'Pasagdi',
    retry: 'Sulayi Pag-usab',
    could_not_reserve: 'Dili ma-reserba ang kanta',
    could_not_play: 'Dili mapatugtog ang kanta',
    no_active_song: 'Walay karon gitugtog',
    no_upcoming_songs: 'Walay nakareserba nga sunod kanta',
    queue_needs_refresh: 'Wala ma-update ang linya',
    reload: 'I-reload',
    restore_failed: 'Dili maibalik ang kanta',
  },
};

let currentLanguage: SupportedLanguage = 'en';

export function setLanguage(lang: SupportedLanguage) {
  if (DICTIONARIES[lang]) {
    currentLanguage = lang;
  }
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function t(key: keyof Translations, lang?: SupportedLanguage): string {
  const active = lang || currentLanguage;
  const dict = DICTIONARIES[active] || DICTIONARIES.en;
  return dict[key] || DICTIONARIES.en[key] || String(key);
}
