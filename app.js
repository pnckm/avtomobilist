import { ENDPOINT, metrics, maxPointsForSeason, parseTables, sortTeams } from './data.js';

const $ = id => document.getElementById(id);
const CACHE_KEY = 'khl-points-v4';
const state = { catalog: null, data: null, season: null, conference: 'east', sort: 'source', direction: 'asc', search: '', busy: false, stale: false, failed: false, selectionWarning: '' };
let seasonMenuSignature = '';
const number = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = value => value == null ? '—' : `${number.format(value)}%`;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stat = value => value == null ? '—' : String(value);
const goalDiff = value => value == null ? '—' : value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0';
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function activeConference() { return state.data?.hasConferences === false ? 'all' : state.conference; }
function filteredTeams(includeSearch = true) {
  if (!state.data) return [];
  const conference = activeConference();
  return state.data.teams.filter(t => (conference === 'all' || t.conference === conference) && (!includeSearch || `${t.name} ${t.city}`.toLocaleLowerCase('ru').includes(state.search.toLocaleLowerCase('ru'))));
}
function visibleTeams() { return sortTeams(filteredTeams(), state.sort === 'source' && activeConference() !== 'all' ? 'conferenceOrder' : state.sort, state.direction); }
function teamLabel(team) {
  const initials = escape(team.name.slice(0, 2).toUpperCase());
  const logo = team.image ? `<img src="${escape(team.image)}" alt="" width="24" height="24" loading="lazy" referrerpolicy="no-referrer">` : initials;
  const conference = activeConference() === 'all' && team.conference ? `<span class="conf" title="${team.conference === 'east' ? 'Восток' : 'Запад'}">${team.conference === 'east' ? 'В' : 'З'}</span>` : '';
  return `<span class="team-label"><span class="team-logo" aria-hidden="true">${logo}</span><span class="team-name">${escape(team.name)}${conference}</span></span>`;
}
function closeSeasonMenu(returnFocus = false) {
  $('season-menu').hidden = true;
  $('season').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('season').focus();
}
function openSeasonMenu() {
  if ($('season').disabled) return;
  $('season-menu').hidden = false;
  $('season').setAttribute('aria-expanded', 'true');
  const selected = $('season-menu').querySelector('[aria-selected="true"]') || $('season-menu').querySelector('button:not([disabled])');
  selected?.focus();
}
function renderSeasonPicker() {
  const available = new Set(state.catalog.seasons.map(s => s.season));
  const labels = [...available, ...state.catalog.unavailableSeasons].sort((a, b) => b.localeCompare(a));
  const signature = `${labels.join('|')}::${state.catalog.unavailableSeasons.join('|')}::${state.data.season}`;
  if (signature !== seasonMenuSignature) {
    $('season-menu').innerHTML = labels.map(label => `<button type="button" role="option" class="season-option" data-season="${label}" tabindex="-1" aria-label="Сезон ${label}${available.has(label) ? '' : ', недоступен'}" aria-selected="${label === state.data.season}"${available.has(label) ? '' : ' disabled'}>${label.slice(0, 4)}/${label.slice(7)}</button>`).join('');
    seasonMenuSignature = signature;
  }
  $('season-label').textContent = `${state.data.season.slice(0, 4)}/${state.data.season.slice(7)}`;
  $('season').value = state.data.season;
  $('season').setAttribute('aria-label', `Выбрать сезон, текущий ${state.data.season}`);
  $('season').disabled = false;
}
function render() {
  if (!state.data) return;
  renderSeasonPicker();
  document.querySelectorAll('[data-conference]').forEach(button => {
    button.disabled = !state.data.hasConferences && button.dataset.conference !== 'all';
    button.setAttribute('aria-pressed', String(button.dataset.conference === activeConference()));
  });
  const max = state.data.maxPoints;
  document.querySelector('th[data-sort="lost"] button').title = `Потерянные очки: ${max} × игры − очки`;
  document.querySelector('th[data-sort="pct"] button').title = `Процент набранных очков: очки / (${max} × игры) × 100%`;
  $('points-legend').textContent = `Потеряно = ${max} × И − О. % очков = О / (${max} × И) × 100%. № — номер строки в текущем порядке.`;
  $('scoring-note').textContent = max === 3 ? 'Система 3–2–1: победа в основное время — 3 очка, в овертайме или по буллитам — 2, поражение в овертайме или по буллитам — 1.' : '';
  $('scoring-note').hidden = max !== 3;
  const all = filteredTeams(false);
  const rows = visibleTeams();
  $('rows').innerHTML = rows.length ? rows.map((t, index) => `<tr><td>${index + 1}</td><td class="team" title="${escape(t.city)}">${teamLabel(t)}</td><td>${t.games}</td><td>${stat(t.wins)}</td><td>${stat(t.otWins)}</td><td>${stat(t.soWins)}</td><td>${stat(t.soLosses)}</td><td>${stat(t.otLosses)}</td><td>${stat(t.losses)}</td><td>${stat(t.goalsFor)}</td><td>${stat(t.goalsAgainst)}</td><td${t.goalDiff < 0 ? ' class="negative"' : ''}>${goalDiff(t.goalDiff)}</td><td class="points">${t.points}</td><td>${t.lost}</td><td class="pct">${pct(t.pct)}</td></tr>`).join('') : '<tr><td colspan="15" class="table-message">Команды не найдены</td></tr>';
  $('rows').querySelectorAll('.team-logo img').forEach(img => img.addEventListener('error', () => {
    const name = img.closest('.team-label').querySelector('.team-name').firstChild.textContent;
    img.parentElement.textContent = name.slice(0, 2).toUpperCase();
  }, { once: true }));
  $('results-count').textContent = `Команд: ${rows.length}${rows.length === all.length ? '' : ` из ${all.length}`}`;
  $('export').disabled = !rows.length;
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const active = th.dataset.sort === state.sort;
    if (active) th.setAttribute('aria-sort', state.direction === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    th.querySelector('.sort-arrow').textContent = active ? state.direction === 'asc' ? '↑' : '↓' : '';
  });
}
function updateStatus() {
  const dateText = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(state.catalog.receivedAt));
  $('data-status').textContent = `${state.stale ? 'Копия от' : 'Получено'} ${dateText}`;
  const messages = [];
  if (state.stale) messages.push(state.failed ? 'Обновить не удалось. Показана сохранённая копия; данные могут быть устаревшими.' : 'Показана сохранённая копия. Загружаем свежие данные…');
  if (state.selectionWarning) messages.push(state.selectionWarning);
  if (!state.data.hasConferences) messages.push('В этом сезоне доступна только общая таблица.');
  if (state.catalog.unavailableSeasons.length) messages.push(`Сезоны с неполными данными недоступны: ${state.catalog.unavailableSeasons.join(', ')}.`);
  notice(messages.join(' '));
}
function showData(catalog, stale = false, failed = false) {
  const requested = state.season;
  const selected = catalog.seasons.find(s => s.season === requested) || catalog.seasons.find(s => s.season === catalog.defaultSeason);
  Object.assign(state, { catalog, data: selected, season: selected.season, stale, failed });
  state.selectionWarning = requested && requested !== selected.season ? `Сезон ${requested} недоступен. Показан ${selected.season}.` : !requested && selected.season !== catalog.expected ? `Сезона ${catalog.expected} нет в источнике. Показан ${selected.season}.` : '';
  render();
  updateStatus();
  document.dispatchEvent(new CustomEvent('khl:season', { detail: { catalog: state.catalog, season: state.data, stale: state.stale } }));
}
export function selectedData() { return { catalog: state.catalog, season: state.data, stale: state.stale }; }
function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached || !Array.isArray(cached.seasons) || !cached.seasons.length || !Array.isArray(cached.unavailableSeasons) || cached.unavailableSeasons.some(label => typeof label !== 'string' || !/^\d{4}\/\d{4}$/.test(label)) || !cached.seasons.some(s => s.season === cached.defaultSeason) || !Number.isFinite(Date.parse(cached.receivedAt))) return null;
    cached.seasons.forEach(s => {
      if (!/^\d{4}\/\d{4}$/.test(s.season) || s.maxPoints !== maxPointsForSeason(s.season) || !Array.isArray(s.teams) || !s.teams.length || typeof s.hasConferences !== 'boolean') throw Error();
      s.teams.forEach(t => {
        const m = metrics(t.games, t.points, s.maxPoints);
        if (typeof t.name !== 'string' || (s.hasConferences && !['west', 'east'].includes(t.conference)) || !Number.isInteger(t.sourceOrder) || !Number.isInteger(t.conferenceOrder)) throw Error();
        Object.assign(t, m);
      });
    });
    return cached;
  } catch { return null; }
}
export async function refresh() {
  if (state.busy) return;
  state.busy = true;
  $('refresh').disabled = true;
  $('refresh').setAttribute('aria-busy', 'true');
  if (!state.data) $('data-status').textContent = 'Загрузка…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(ENDPOINT, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = { ...parseTables(await response.json()), receivedAt: new Date().toISOString() };
    showData(data);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
  } catch {
    if (state.catalog) showData(state.catalog, true, true);
    else {
      $('data-status').textContent = 'Источник недоступен';
      notice('Не удалось получить данные. Попробуйте обновить таблицу.');
      $('rows').innerHTML = '<tr><td colspan="15" class="table-message">Таблица временно недоступна. <a href="https://www.khl.ru/standings/" target="_blank" rel="noopener noreferrer">Таблица КХЛ ↗</a></td></tr>';
      $('results-count').textContent = 'Данные не загружены';
    }
  } finally {
    clearTimeout(timeout);
    state.busy = false;
    $('refresh').disabled = false;
    $('refresh').removeAttribute('aria-busy');
  }
}
document.querySelectorAll('[data-conference]').forEach(button => button.addEventListener('click', () => {
  state.conference = button.dataset.conference;
  render();
}));
$('season').addEventListener('click', () => {
  if ($('season-menu').hidden) openSeasonMenu();
  else closeSeasonMenu();
});
$('season').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openSeasonMenu(); }
});
$('season-menu').addEventListener('click', event => {
  const option = event.target.closest('[data-season]');
  if (!option || option.disabled) return;
  closeSeasonMenu(true);
  selectSeason(option.dataset.season);
});
export function selectSeason(label) {
  const selected = state.catalog?.seasons.find(s => s.season === label);
  if (!selected) return false;
  Object.assign(state, { data: selected, season: selected.season, selectionWarning: '' });
  render();
  updateStatus();
  document.dispatchEvent(new CustomEvent('khl:season', { detail: { catalog: state.catalog, season: state.data, stale: state.stale } }));
  return true;
}
$('season-menu').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSeasonMenu(true); return; }
  if (event.key === 'Tab') { closeSeasonMenu(true); return; }
  const options = [...$('season-menu').querySelectorAll('button:not([disabled])')];
  const index = options.indexOf(document.activeElement);
  let next;
  if (event.key === 'ArrowDown') next = index + 3;
  else if (event.key === 'ArrowUp') next = index - 3;
  else if (event.key === 'ArrowRight') next = index + 1;
  else if (event.key === 'ArrowLeft') next = index - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else return;
  event.preventDefault();
  options[Math.max(0, Math.min(options.length - 1, next))]?.focus();
});
document.addEventListener('click', event => { if (!$('season-picker').contains(event.target)) closeSeasonMenu(); });
document.querySelectorAll('th[data-sort] button').forEach(button => button.addEventListener('click', () => {
  const key = button.parentElement.dataset.sort;
  state.direction = state.sort === key ? (state.direction === 'asc' ? 'desc' : 'asc') : ['source', 'lost', 'losses', 'otLosses', 'soLosses', 'goalsAgainst'].includes(key) ? 'asc' : 'desc';
  state.sort = key;
  render();
}));
$('search').addEventListener('input', event => { state.search = event.target.value.trim(); render(); });
$('reset').addEventListener('click', () => {
  Object.assign(state, { sort: 'source', direction: 'asc' });
  render();
});
$('refresh').addEventListener('click', refresh);
$('export').addEventListener('click', () => {
  const safeCell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const lines = [['Сезон', 'Команда', 'Конференция', 'И', 'В', 'ВО', 'ВБ', 'ПБ', 'ПО', 'П', 'ШЗ', 'ШП', 'РШ', 'О', 'Потеряно', '% очков', 'Макс. очков за матч', 'Получено'], ...visibleTeams().map(t => [state.data.season, t.name, t.conference === 'east' ? 'Восток' : t.conference === 'west' ? 'Запад' : '', t.games, t.wins, t.otWins, t.soWins, t.soLosses, t.otLosses, t.losses, t.goalsFor, t.goalsAgainst, t.goalDiff, t.points, t.lost, t.pct == null ? '' : t.pct.toFixed(2).replace('.', ','), state.data.maxPoints, state.catalog.receivedAt])];
  const blob = new Blob(['\uFEFF' + lines.map(row => row.map(safeCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `khl-${state.data.season.replace('/', '-')}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const cached = readCache();
if (cached) showData(cached, true);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!state.catalog || Date.now() - Date.parse(state.catalog.receivedAt) > 5 * 60 * 1000)) refresh(); });
