export const ENDPOINT = 'https://khl.api.webcaster.pro/api/khl_mobile/tables_v2.json';

export function metrics(games, points, maxPoints = 2) {
  if (![2, 3].includes(maxPoints) || !Number.isInteger(games) || games < 0 || !Number.isInteger(points) || points < 0 || points > maxPoints * games) throw new Error('Некорректные игры или очки');
  return { lost: maxPoints * games - points, pct: games === 0 ? null : points / (maxPoints * games) * 100 };
}

export function maxPointsForSeason(season) { return Number(season.slice(0, 4)) >= 2018 ? 2 : 3; }

export function currentSeason(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', year: 'numeric', month: 'numeric' }).formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year').value);
  const month = Number(parts.find(p => p.type === 'month').value);
  const start = month >= 7 ? year : year - 1;
  return `${start}/${start + 1}`;
}

export function parseSeason(season) {
  const rows = season.tables?.championship;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Нет таблицы регулярного чемпионата');
  const maxPoints = maxPointsForSeason(season.season);
  const conferenceRows = ['west', 'east'].map(key => season.tables[key] || []);
  if (conferenceRows.some(table => !Array.isArray(table))) throw new Error('Некорректные таблицы конференций');
  const hasConferences = conferenceRows.every(table => table.length > 0);
  const conferenceMap = new Map();
  if (hasConferences) conferenceRows.forEach((table, conferenceIndex) => table.forEach((team, index) => {
    const id = String(team.khl_id ?? team.id ?? '');
    if (!id || conferenceMap.has(id)) throw new Error('Некорректный состав конференций');
    conferenceMap.set(id, { conference: conferenceIndex === 0 ? 'west' : 'east', conferenceOrder: index });
  }));
  const seen = new Set();
  const teams = rows.map((t, index) => {
    if (t.gp === '' || t.pts === '' || t.gp == null || t.pts == null) throw new Error('В источнике отсутствуют игры или очки');
    const games = Number(t.gp), points = Number(t.pts);
    const calculated = metrics(games, points, maxPoints);
    const id = String(t.khl_id ?? t.id ?? '');
    if (!id || seen.has(id) || typeof t.name !== 'string' || !t.name.trim() || (hasConferences && !conferenceMap.has(id))) throw new Error('Некорректная команда в источнике');
    seen.add(id);
    const detail = field => {
      if (t[field] == null || t[field] === '') return null;
      const value = Number(t[field]);
      if (!Number.isInteger(value) || value < 0) throw new Error('Некорректная статистика команды');
      return value;
    };
    const goalsFor = detail('gf'), goalsAgainst = detail('ga');
    let image = null;
    try {
      const url = new URL(t.image);
      if (url.protocol === 'https:' && url.hostname.endsWith('.webcaster.pro')) image = url.href;
    } catch {}
    return { id, providerId: Number.isInteger(Number(t.id)) ? Number(t.id) : null, name: t.name, city: typeof t.location === 'string' ? t.location : '', conference: conferenceMap.get(id)?.conference ?? null, conferenceOrder: conferenceMap.get(id)?.conferenceOrder ?? index, games, points, ...calculated, image,
      wins: detail('w'), otWins: detail('otw'), soWins: detail('sow'), soLosses: detail('sol'), otLosses: detail('otl'), losses: detail('l'),
      goalsFor, goalsAgainst, goalDiff: goalsFor == null || goalsAgainst == null ? null : goalsFor - goalsAgainst, sourceOrder: index };
  });
  if (hasConferences && conferenceMap.size !== teams.length) throw new Error('Неполный состав чемпионата');
  const stage = Array.isArray(season.stages) ? season.stages.find(s => s.type === 'regular') : null;
  return { season: season.season, stageId: Number.isInteger(Number(stage?.id)) && Number(stage.id) > 0 ? Number(stage.id) : null, maxPoints, hasConferences, teams };
}

export function parseTables(payload, expected = currentSeason()) {
  if (!Array.isArray(payload)) throw new Error('Изменился формат источника');
  const entries = payload.filter(s => /^\d{4}\/\d{4}$/.test(s.season) && Number(s.season.slice(0, 4)) >= 2008 && Number(s.season.slice(5)) === Number(s.season.slice(0, 4)) + 1 && s.season <= expected).sort((a, b) => b.season.localeCompare(a.season));
  const seasons = [], unavailableSeasons = [];
  for (const entry of entries) {
    try { seasons.push(parseSeason(entry)); }
    catch { unavailableSeasons.push(entry.season); }
  }
  if (!seasons.length) throw new Error('В источнике нет таблиц регулярного чемпионата');
  return { seasons, unavailableSeasons, expected, defaultSeason: seasons.some(s => s.season === expected) ? expected : seasons[0].season };
}

export function sortTeams(teams, sort = 'source', direction = ['source', 'conferenceOrder', 'lost'].includes(sort) ? 'asc' : 'desc') {
  return [...teams].sort((a, b) => {
    const key = sort === 'source' ? 'sourceOrder' : sort;
    if (a[key] == null && b[key] != null) return 1;
    if (a[key] != null && b[key] == null) return -1;
    const difference = a[key] == null ? 0 : (a[key] - b[key]) * (direction === 'asc' ? 1 : -1);
    return difference || a.sourceOrder - b.sourceOrder;
  });
}
