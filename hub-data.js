export const CLUB_ID = 190;
export const PROVIDER_TEAM_ID = 56;
export const TEAM_TIMEZONE = 'Asia/Yekaterinburg';
const API = 'https://khl.api.webcaster.pro/api/khl_mobile/';
const BUNDLE_VERSION = 2;
let requestSlot = Promise.resolve();
let lastRequest = Date.now();

export function numeric(value) {
  if (value == null || value === '') return null;
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.').replace('%', '') : value);
  return Number.isFinite(parsed) ? parsed : null;
}
const label = value => typeof value === 'string' ? value.trim().slice(0, 250) : '';
export function safeImage(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, 'https://www.khl.ru');
    const trusted = url.hostname === 'khl.ru' || url.hostname.endsWith('.khl.ru') || url.hostname.endsWith('.webcaster.pro');
    if (!trusted || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}
function statMap(stats) {
  return Object.fromEntries((Array.isArray(stats) ? stats : []).filter(s => typeof s.id === 'string').map(s => [s.id, numeric(s.val)]));
}
function abortError() { return new DOMException('Загрузка отменена', 'AbortError'); }
async function api(path, parameters, signal) {
  if (signal?.aborted) throw abortError();
  const url = new URL(path, API);
  for (const [key, value] of parameters) url.searchParams.append(key, String(value));
  const slot = requestSlot.then(async () => {
    if (signal?.aborted) throw abortError();
    const delay = Math.max(0, 1000 - (Date.now() - lastRequest));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (signal?.aborted) throw abortError();
    lastRequest = Date.now();
  });
  requestSlot = slot.catch(() => {});
  await slot;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(cancel, 15000);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Источник ответил HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export function parseScore(value) {
  if (typeof value !== 'string') return null;
  const found = value.trim().match(/^(\d+)\s*:\s*(\d+)$/);
  return found ? [Number(found[1]), Number(found[2])] : null;
}
function normalizeTeam(team) {
  if (!team || !numeric(team.id) || !label(team.name)) throw new Error('Нет данных команды');
  return { id: Number(team.id), clubId: numeric(team.khl_id), name: label(team.name), city: label(team.location), image: safeImage(team.image) };
}
export function normalizeGame(input) {
  const event = input?.event || input;
  if (!event || !numeric(event.id)) throw new Error('Некорректная карточка матча');
  const home = normalizeTeam(event.team_a), away = normalizeTeam(event.team_b);
  const status = ['finished', 'in_progress', 'not_yet_started'].includes(event.game_state_key) ? event.game_state_key : 'unknown';
  const periods = Object.fromEntries(['first_period', 'second_period', 'third_period', 'overtime', 'bullitt'].map(key => [key, parseScore(event.scores?.[key])]));
  const timestamp = numeric(event.start_at);
  return {
    id: Number(event.id), khlId: numeric(event.khl_id), stageId: numeric(event.stage_id), tournamentId: numeric(event.outer_stage_id),
    startsAt: timestamp != null && timestamp > 100000000000 ? timestamp : null,
    status, home, away, score: status === 'not_yet_started' ? null : parseScore(event.score), periods,
    extra: periods.bullitt !== null ? 'Б' : periods.overtime !== null ? 'ОТ' : '',
    isHome: home.clubId === CLUB_ID || home.id === PROVIDER_TEAM_ID,
  };
}
export function gameResult(game, maxPoints = 2) {
  if (game.status !== 'finished' || !game.score || game.score[0] === game.score[1]) return null;
  const own = game.score[game.isHome ? 0 : 1], against = game.score[game.isHome ? 1 : 0];
  const won = own > against;
  return { won, own, against, code: (won ? 'В' : 'П') + (game.extra === 'Б' ? 'Б' : game.extra === 'ОТ' ? 'О' : ''), points: won ? (maxPoints === 3 && !game.extra ? 3 : 2) : game.extra ? 1 : 0 };
}
export function normalizePlayer(input) {
  const player = input?.player || input;
  if (!player || !numeric(player.id) || !label(player.name)) throw new Error('Некорректная карточка игрока');
  const stats = statMap(player.stats);
  const fields = ['gp', 'g', 'a', 'pts', 'pm', 'pim', 'toi_avg', 'w', 'l', 'ga', 'sv', 'sv_pct', 'gaa', 'so', 'toi'];
  return {
    id: Number(player.id), khlId: numeric(player.khl_id), name: label(player.name), number: numeric(player.shirt_number),
    role: ['forward', 'defensemen', 'goaltender'].includes(player.role_key) ? player.role_key : 'unknown',
    image: safeImage(player.image), stats: Object.fromEntries(fields.map(key => [key, stats[key] ?? null])),
  };
}
export function formatIceTime(minutes) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—';
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function belongsToClub(game) { return game.home.clubId === CLUB_ID || game.away.clubId === CLUB_ID || game.home.id === PROVIDER_TEAM_ID || game.away.id === PROVIDER_TEAM_ID; }
async function loadGames(stageId, signal) {
  const matches = new Map();
  for (let page = 1; page <= 30; page++) {
    const body = await api('events_v2.json', [['stage_id', stageId], ['page', page], ['q[team_a_or_team_b_in][]', PROVIDER_TEAM_ID], ['locale', 'ru']], signal);
    if (!Array.isArray(body)) throw new Error('Изменился формат календаря');
    if (!body.length) break;
    let added = 0;
    for (const input of body) {
      const game = normalizeGame(input);
      if (game.stageId !== null && game.stageId !== Number(stageId)) throw new Error('Календарь относится к другому сезону');
      if (!belongsToClub(game)) continue;
      if (!matches.has(game.id)) added++;
      matches.set(game.id, game);
    }
    if (body.length < 16) break;
    if (!added) throw new Error('Источник повторяет страницу календаря');
    if (page === 30) throw new Error('Не удалось загрузить календарь целиком');
  }
  return [...matches.values()].sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity) || a.id - b.id);
}
async function loadPlayers(stageId, signal, onTeam) {
  const response = await api('team_v2.json', [['id', PROVIDER_TEAM_ID], ['stage_id', stageId], ['locale', 'ru']], signal);
  const team = response?.team;
  if (!team || Number(team.id) !== PROVIDER_TEAM_ID || !Array.isArray(team.players)) throw new Error('Источник не вернул состав «Автомобилиста»');
  const roster = team.players.map(p => normalizePlayer(p));
  onTeam(normalizeTeam(team));
  const ids = [...new Set(roster.map(p => p.id))];
  const players = new Map();
  for (let offset = 0; offset < ids.length; offset += 12) {
    const batch = ids.slice(offset, offset + 12);
    const response = await api('players_v2.json', [['stage_id', stageId], ['locale', 'ru'], ...batch.map(id => ['q[id_in][]', id])], signal);
    if (!Array.isArray(response)) throw new Error('Изменился формат статистики игроков');
    for (const item of response) {
      const player = normalizePlayer(item);
      if (batch.includes(player.id)) players.set(player.id, player);
    }
  }
  const missing = ids.filter(id => !players.has(id));
  return { players: roster.map(p => players.get(p.id) || p), missing: missing.length };
}
function cacheKey(season) { return `avto-hub-v${BUNDLE_VERSION}:${season}`; }
export function cachedBundle(season, stageId) {
  try {
    const bundle = JSON.parse(localStorage.getItem(cacheKey(season)));
    if (bundle?.version !== BUNDLE_VERSION || bundle.season !== season || bundle.stageId !== stageId || !Array.isArray(bundle.games) || !Array.isArray(bundle.players) || !Number.isFinite(bundle.fetchedAt)) return null;
    return bundle;
  } catch { return null; }
}
export async function loadBundle(season, { signal, onUpdate = () => {} } = {}) {
  if (!season.stageId) throw new Error('Для этого сезона нет данных календаря');
  const old = cachedBundle(season.season, season.stageId);
  const bundle = {
    version: BUNDLE_VERSION, season: season.season, stageId: season.stageId, fetchedAt: Date.now(),
    team: old?.team || null, games: old?.games || [], players: old?.players || [],
    gamesLoaded: false, playersLoaded: false, missingPlayers: 0, errors: {},
  };
  const report = () => { if (!signal?.aborted) onUpdate({ ...bundle, errors: { ...bundle.errors } }); };
  report();
  await Promise.all([
    loadGames(season.stageId, signal).then(games => { bundle.games = games; bundle.gamesLoaded = true; report(); }).catch(error => { if (signal?.aborted) return; bundle.errors.games = error.message || 'Не удалось загрузить календарь'; report(); }),
    loadPlayers(season.stageId, signal, team => { bundle.team = team; report(); }).then(result => { bundle.players = result.players; bundle.playersLoaded = true; bundle.missingPlayers = result.missing; report(); }).catch(error => { if (signal?.aborted) return; bundle.errors.players = error.message || 'Не удалось загрузить игроков'; report(); }),
  ]);
  if (signal?.aborted) throw abortError();
  bundle.fetchedAt = Date.now();
  if (bundle.gamesLoaded || bundle.playersLoaded) {
    try { localStorage.setItem(cacheKey(season.season), JSON.stringify(bundle)); } catch {}
  }
  report();
  return bundle;
}
