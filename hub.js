import { selectedData } from './app.js';
import { CLUB_ID, TEAM_TIMEZONE, safeImage, cachedBundle, loadBundle, gameResult, formatIceTime } from './hub-data.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hub = { context: null, bundle: null, loading: false, error: '', loadController: null, month: null, calendarMode: 'month', venue: 'all', playerGroup: 'skaters', playerRole: 'all', playerSearch: '', playerSort: 'pts', playerDirection: 'desc', route: 'overview' };
const nf = new Intl.NumberFormat('ru-RU');
const one = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const two = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TEAM_TIMEZONE, day: 'numeric', month: 'short' });
const fullDateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TEAM_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TEAM_TIMEZONE, hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const num = value => value == null || !Number.isFinite(value) ? '—' : nf.format(value);
const pct = value => value == null || !Number.isFinite(value) ? '—' : `${one.format(value)}%`;
const roleLabel = role => ({ forward: 'Нападающий', defensemen: 'Защитник', goaltender: 'Вратарь', unknown: '—' }[role] || '—');
const shortRole = role => ({ forward: 'Н', defensemen: 'З', goaltender: 'В' }[role] || '—');
const season = () => hub.context?.season;
const team = () => season()?.teams.find(t => Number(t.id) === CLUB_ID);
const games = () => hub.bundle?.games || [];
const players = () => hub.bundle?.players || [];
const finished = () => games().filter(g => g.status === 'finished');
const opponent = game => game.isHome ? game.away : game.home;
const matchUrl = game => game.khlId && game.tournamentId ? `https://www.khl.ru/game/${game.tournamentId}/${game.khlId}/protocol/` : 'https://www.khl.ru/calendar/';
function mark(item, size = '') {
  const source = safeImage(item?.image), fallback = String(item?.name || 'А').slice(0, 2).toUpperCase();
  return `<span class="team-mark ${size}" data-fallback="${escape(fallback)}">${source ? `<img src="${escape(source)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : escape(fallback)}</span>`;
}
function playerMark(player) {
  const source = safeImage(player.image), initials = player.name.split(' ').slice(0, 2).map(n => n[0]).join('');
  return `<span class="player-photo" data-fallback="${escape(initials)}">${source ? `<img src="${escape(source)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : escape(initials)}</span>`;
}
function empty(message, retry = false) { return `<div class="panel empty-panel"><p>${escape(message)}</p>${retry ? '<button type="button" class="button" data-retry-season>Повторить загрузку</button>' : ''}</div>`; }
function score(game) {
  if (game.status === 'not_yet_started') return game.startsAt ? timeFmt.format(game.startsAt) : '—';
  return game.score ? `${game.score[0]} : ${game.score[1]}` : '—';
}
function clubScore(game) {
  if (game.status === 'not_yet_started' || !game.score || game.isHome) return score(game);
  return `${game.score[1]} : ${game.score[0]}`;
}
const pluralRules = new Intl.PluralRules('ru');
const noun = (value, forms) => forms[pluralRules.select(value)] || forms.other;
function statusLabel(game) { return game.status === 'in_progress' ? 'Идёт матч' : game.status === 'finished' ? `Завершён${game.extra ? ` · ${game.extra}` : ''}` : game.status === 'not_yet_started' ? 'Предстоящий матч' : 'Статус уточняется'; }
function resultBadge(game) {
  const result = gameResult(game, season()?.maxPoints);
  if (!result) return game.status === 'in_progress' ? '<span class="result live">LIVE</span>' : '';
  return `<span class="result ${result.won ? 'win' : 'loss'}" title="${result.won ? 'Победа' : 'Поражение'}${game.extra ? ` · ${game.extra}` : ''}">${result.code}</span>`;
}
function dateKey(time) {
  if (!time) return null;
  const parts = keyFmt.formatToParts(time);
  const value = type => parts.find(p => p.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function focusGame() {
  return games().find(g => g.status === 'in_progress') || games().find(g => g.status === 'not_yet_started' && (!g.startsAt || g.startsAt >= Date.now())) || games().find(g => g.status === 'not_yet_started') || finished().at(-1) || null;
}
function renderStatus() {
  const messages = [];
  if (hub.loading) messages.push('Обновляем календарь и статистику команды…');
  if (hub.error) messages.push(hub.error);
  if (hub.bundle && Object.keys(hub.bundle.errors || {}).length) messages.push('Часть данных не удалось обновить. Сохранённые значения могут быть устаревшими.');
  $('hub-status').textContent = messages.join(' ');
  $('hub-status').hidden = !messages.length || hub.route === 'table';
  $('hub-status').classList.toggle('has-error', Boolean(hub.error || Object.keys(hub.bundle?.errors || {}).length));
}
function absentTeam() {
  if (!season()) return empty('Загружаем данные сезона…');
  return empty(`В таблице сезона ${season().season} нет «Автомобилиста». Выберите другой сезон или откройте таблицу КХЛ.`);
}
function seasonStats() {
  const t = team();
  const values = [
    ['Место на Востоке', t.conference ? num(t.conferenceOrder + 1) : '—', `Сыграно матчей: ${num(t.games)}`],
    ['Очки', num(t.points), `${num([t.wins, t.otWins, t.soWins].every(v => v !== null) ? t.wins + t.otWins + t.soWins : null)} побед за сезон`],
    ['Набрано от максимума', pct(t.pct), `${num(t.goalsFor)}–${num(t.goalsAgainst)} по шайбам`],
    ['Потерянные очки', num(t.lost), `${season().maxPoints} × ${t.games} − ${t.points}`],
  ];
  return `<div class="club-stats">${values.map(([label, value, note]) => `<article class="club-stat"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')}</div>`;
}
function mainMatch() {
  const game = focusGame();
  if (!game) return `<div class="featured-match pending"><div class="section-kicker">Календарь команды</div><h2>${hub.bundle?.errors.games ? 'Календарь недоступен' : hub.bundle?.gamesLoaded ? 'В календаре пока нет матчей' : 'Загружаем матчи…'}</h2><p>${hub.bundle?.errors.games ? 'Попробуйте обновить данные.' : 'Ближайшая игра появится здесь.'}</p></div>`;
  const label = game.status === 'in_progress' ? 'Сейчас на льду' : game.status === 'not_yet_started' ? 'Ближайший матч' : 'Последний матч сезона';
  return `<article class="featured-match"><div class="featured-top"><span class="section-kicker">${label}</span><span class="venue-pill">${game.isHome ? 'Дома' : 'В гостях'}</span></div><p class="featured-date">${game.startsAt ? fullDateFmt.format(game.startsAt) : 'Дата уточняется'}${game.startsAt ? ` · ${timeFmt.format(game.startsAt)}` : ''}</p><div class="featured-teams"><div>${mark(game.home, 'large')}<strong>${escape(game.home.name)}</strong></div><div class="featured-score">${game.status === 'not_yet_started' ? '<span class="versus">vs</span>' : `<strong>${score(game)}</strong>`}<small${game.status === 'in_progress' ? ' class="live-text"' : ''}>${statusLabel(game)}</small></div><div>${mark(game.away, 'large')}<strong>${escape(game.away.name)}</strong></div></div><a class="match-cta" href="${matchUrl(game)}" target="_blank" rel="noopener noreferrer">Матч на КХЛ <span aria-hidden="true">↗</span></a></article>`;
}
function recentPanel() {
  const recent = [...finished()].reverse().slice(0, 5);
  const form = finished().slice(-10);
  const points = form.reduce((sum, game) => sum + (gameResult(game, season().maxPoints)?.points || 0), 0);
  return `<section class="panel recent-panel"><div class="panel-heading"><h2>Последние матчи</h2><a href="#calendar">Календарь ↗</a></div>${recent.length ? `<p class="score-key">Счёт: «Автомобилист» — соперник</p><div class="recent-matches">${recent.map(game => `<a class="recent-game" href="${matchUrl(game)}" target="_blank" rel="noopener noreferrer"><span class="match-date">${game.startsAt ? dateFmt.format(game.startsAt) : '—'}</span><span class="opponent">${mark(opponent(game))}<strong>${escape(opponent(game).name)}</strong><small>${game.isHome ? 'Дома' : 'В гостях'}</small></span><strong class="recent-score">${clubScore(game)}<small>${game.extra}</small></strong>${resultBadge(game)}</a>`).join('')}</div><div class="form-heading"><span>Последние ${form.length} матчей</span><strong>${points} из ${form.length * season().maxPoints} очков</strong></div><div class="form-bars" aria-label="Очки в последних матчах">${form.map(game => { const r = gameResult(game, season().maxPoints); return `<a href="${matchUrl(game)}" target="_blank" rel="noopener noreferrer" class="form-bar ${r?.won ? 'win' : 'loss'}" title="${escape(opponent(game).name)} · ${clubScore(game)} · ${r?.points ?? '—'} очк."><span style="height:${r ? 18 + r.points / season().maxPoints * 75 : 18}%"></span><small>${r?.points ?? '—'}</small></a>`; }).join('')}</div>` : `<p class="panel-empty">${hub.bundle?.errors.games ? 'Не удалось загрузить результаты.' : hub.loading ? 'Загружаем результаты…' : 'Завершённых матчей пока нет.'}</p>`}</section>`;
}
function eastPanel() {
  const east = season().teams.filter(t => t.conference === 'east').sort((a, b) => a.conferenceOrder - b.conferenceOrder);
  const index = east.findIndex(t => Number(t.id) === CLUB_ID), start = Math.max(0, Math.min(index - 2, east.length - 5));
  const rows = east.slice(start, start + 5);
  return `<section class="panel east-panel"><div class="panel-heading"><h2>На Востоке</h2><a href="#table">Вся таблица ↗</a></div><table class="compact-table"><thead><tr><th>№</th><th>Команда</th><th title="Сыгранные матчи">И</th><th title="Очки">О</th><th title="Процент набранных очков">%</th></tr></thead><tbody>${rows.map(t => `<tr${Number(t.id) === CLUB_ID ? ' class="own-team"' : ''}><td>${t.conferenceOrder + 1}</td><td>${mark(t)}<span>${escape(t.name)}</span></td><td>${t.games}</td><td><strong>${t.points}</strong></td><td>${pct(t.pct)}</td></tr>`).join('')}</tbody></table><div class="club-rates"><div><span>Забивает за матч</span><strong>${team().games && team().goalsFor !== null ? two.format(team().goalsFor / team().games) : '—'}</strong></div><div><span>Пропускает за матч</span><strong>${team().games && team().goalsAgainst !== null ? two.format(team().goalsAgainst / team().games) : '—'}</strong></div></div></section>`;
}
function leadersPanel() {
  const leaders = players().filter(p => p.role !== 'goaltender' && p.stats.pts !== null).sort((a, b) => b.stats.pts - a.stats.pts || (b.stats.g ?? 0) - (a.stats.g ?? 0)).slice(0, 3);
  return `<section class="panel leaders-panel"><div class="panel-heading"><h2>Лидеры команды</h2><a href="#players">Все игроки ↗</a></div><div class="leader-grid">${leaders.length ? leaders.map(player => `<article class="leader-card">${playerMark(player)}<div><small>№ ${num(player.number)} · ${roleLabel(player.role)}</small><strong>${escape(player.name)}</strong><span>${num(player.stats.g)} ${noun(player.stats.g, {one:'гол',few:'гола',other:'голов'})} + ${num(player.stats.a)} ${noun(player.stats.a, {one:'передача',few:'передачи',other:'передач'})}</span></div><b>${num(player.stats.pts)}<small>очков</small></b></article>`).join('') : `<p class="panel-empty">${hub.bundle?.errors.players ? 'Не удалось загрузить статистику игроков.' : hub.bundle?.playersLoaded ? 'В источнике нет данных для списка лидеров.' : 'Загружаем лидеров команды…'}</p>`}</div></section>`;
}
function renderOverview() {
  if (!team()) { $('overview-content').innerHTML = absentTeam(); return; }
  $('overview-content').innerHTML = `<div class="overview-top">${mainMatch()}${seasonStats()}</div><div class="overview-middle">${recentPanel()}${eastPanel()}</div>${leadersPanel()}`;
}
function ensureMonth() {
  const valid = games().filter(g => g.startsAt);
  if (!valid.length || hub.month) return;
  const now = dateKey(Date.now()).slice(0, 7), first = dateKey(valid[0].startsAt).slice(0, 7), last = dateKey(valid.at(-1).startsAt).slice(0, 7);
  hub.month = now >= first && now <= last ? now : first;
}
function selectedGames() { return games().filter(game => hub.venue === 'all' || (hub.venue === 'home' ? game.isHome : !game.isHome)); }
function renderCalendar() {
  document.querySelectorAll('[data-calendar-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.calendarMode === hub.calendarMode)));
  document.querySelectorAll('[data-venue]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.venue === hub.venue)));
  $('calendar-meta').textContent = '';
  if (!team() || !games().length) {
    $('calendar-month').textContent = '—';
    $('calendar-prev').disabled = true;
    $('calendar-next').disabled = true;
  }
  if (!team()) { $('calendar-content').innerHTML = absentTeam(); return; }
  ensureMonth();
  if (!games().length) {
    $('calendar-content').innerHTML = empty(hub.bundle?.errors.games ? 'Не удалось загрузить календарь.' : hub.loading ? 'Загружаем календарь…' : 'В источнике пока нет матчей этого сезона.', Boolean(hub.bundle?.errors.games));
    $('calendar-meta').textContent = '';
    return;
  }
  const dates = games().filter(g => g.startsAt), firstMonth = dates.length ? dateKey(dates[0].startsAt).slice(0, 7) : null, lastMonth = dates.length ? dateKey(dates.at(-1).startsAt).slice(0, 7) : null;
  const [year, month] = (hub.month || dateKey(Date.now()).slice(0, 7)).split('-').map(Number);
  $('calendar-month').textContent = monthFmt.format(Date.UTC(year, month - 1, 15));
  $('calendar-prev').disabled = !firstMonth || hub.month <= firstMonth;
  $('calendar-next').disabled = !lastMonth || hub.month >= lastMonth;
  $('calendar-nearest').textContent = games().some(g => g.status !== 'finished') ? 'Ближайший матч' : 'Последний матч';
  const monthGames = selectedGames().filter(game => dateKey(game.startsAt)?.startsWith(hub.month));
  $('calendar-meta').textContent = `Матчей в сезоне: ${games().length}`;
  if (hub.calendarMode === 'list') {
    $('calendar-content').innerHTML = monthGames.length ? `<div class="panel schedule-list">${monthGames.map(game => `<a class="schedule-row" href="${matchUrl(game)}" target="_blank" rel="noopener noreferrer"><span class="schedule-date"><strong>${game.startsAt ? dateFmt.format(game.startsAt) : '—'}</strong>${game.startsAt && game.status !== 'not_yet_started' ? `<small>${timeFmt.format(game.startsAt)}</small>` : ''}</span><span class="opponent">${mark(opponent(game))}<strong>${escape(opponent(game).name)}</strong></span><span class="schedule-venue">${game.isHome ? 'Дома' : 'В гостях'}</span><span class="schedule-score"><strong>${clubScore(game)}</strong><small>${game.extra || (game.status === 'in_progress' ? 'LIVE' : '')}</small></span>${resultBadge(game)}<span class="row-arrow" aria-hidden="true">↗</span></a>`).join('')}</div>` : empty('В этом месяце матчей с выбранным фильтром нет.');
    return;
  }
  const firstDay = new Date(Date.UTC(year, month - 1, 1)), offset = (firstDay.getUTCDay() + 6) % 7, lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(), totalCells = Math.ceil((offset + lastDay) / 7) * 7;
  const today = dateKey(Date.now());
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > lastDay) return '<div class="calendar-day outside" aria-hidden="true"></div>';
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = monthGames.filter(game => dateKey(game.startsAt) === key);
    return `<div class="calendar-day${today === key ? ' today' : ''}${events.length ? ' has-game' : ''}"><span class="day-number">${day}</span>${events.map(game => `<a href="${matchUrl(game)}" target="_blank" rel="noopener noreferrer" class="game-chip ${game.isHome ? 'home-game' : 'away-game'}" aria-label="${escape(`${fullDateFmt.format(game.startsAt)}, ${opponent(game).name}, ${game.isHome ? 'дома' : 'в гостях'}, ${clubScore(game)}`)}"><span class="chip-opponent">${mark(opponent(game))}<span>${escape(opponent(game).name)}</span></span><span class="chip-bottom"><strong>${clubScore(game)}</strong><small>${game.status === 'in_progress' ? 'LIVE' : game.extra || (game.isHome ? 'Дома' : 'Выезд')}</small></span></a>`).join('')}</div>`;
  }).join('');
  $('calendar-content').innerHTML = `<div class="panel calendar-board"><div class="weekdays">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells}</div></div><p class="calendar-key"><span class="home-key"></span>Дома <span class="away-key"></span>В гостях · Матчи открываются на сайте КХЛ ↗</p>`;
}
function playerColumn(key, title, description = title) { return `<th data-player-sort="${key}"${hub.playerSort === key ? ` aria-sort="${hub.playerDirection === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" title="${escape(description)}">${title}${hub.playerSort === key ? hub.playerDirection === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>`; }
function renderPlayers() {
  $('players-meta').textContent = team() && players().length ? `В составе: ${players().length}${hub.bundle?.missingPlayers ? ` · нет подробных данных: ${hub.bundle.missingPlayers}` : ''}` : '';
  document.querySelectorAll('[data-player-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.playerGroup === hub.playerGroup)));
  document.querySelectorAll('[data-player-role]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.playerRole === hub.playerRole)));
  document.querySelector('.player-role-filters').hidden = hub.playerGroup === 'goalies';
  if (!team()) { $('players-content').innerHTML = absentTeam(); return; }
  if (!players().length) { $('players-content').innerHTML = empty(hub.bundle?.errors.players ? 'Не удалось загрузить статистику игроков.' : hub.loading ? 'Загружаем состав и личную статистику…' : 'Для этого сезона нет статистики игроков.', Boolean(hub.bundle?.errors.players)); return; }
  const filtered = players().filter(player => (hub.playerGroup === 'goalies' ? player.role === 'goaltender' : player.role !== 'goaltender' && (hub.playerRole === 'all' || player.role === hub.playerRole)) && player.name.toLocaleLowerCase('ru').includes(hub.playerSearch.toLocaleLowerCase('ru')));
  const value = p => hub.playerSort === 'name' ? p.name : p.stats[hub.playerSort];
  filtered.sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    return ((typeof x === 'string' ? x.localeCompare(y, 'ru') : (x ?? 0) - (y ?? 0)) * (hub.playerDirection === 'asc' ? 1 : -1)) || a.name.localeCompare(b.name, 'ru');
  });
  const goalie = hub.playerGroup === 'goalies';
  const columns = goalie ? playerColumn('gp', 'И', 'Игры') + playerColumn('w', 'В', 'Победы') + playerColumn('l', 'П', 'Поражения') + playerColumn('ga', 'ПШ', 'Пропущенные шайбы') + playerColumn('sv', 'ОБ', 'Отражённые броски') + playerColumn('sv_pct', '% ОБ', 'Процент отражённых бросков') + playerColumn('gaa', 'КН', 'Коэффициент надёжности') + playerColumn('so', 'СИ', 'Сухие игры') : playerColumn('gp', 'И', 'Игры') + playerColumn('g', 'Г', 'Голы') + playerColumn('a', 'П', 'Голевые передачи') + playerColumn('pts', 'О', 'Очки: голы + передачи') + playerColumn('pm', '+/−', 'Показатель полезности') + playerColumn('pim', 'Штр', 'Штрафные минуты') + playerColumn('toi_avg', 'Вр/И', 'Среднее время на льду за игру');
  const rows = filtered.map((p, index) => `<tr><td>${index + 1}</td><td class="player-name-cell">${playerMark(p)}<span><strong>${escape(p.name)}</strong><small>№ ${num(p.number)} · ${roleLabel(p.role)}</small></span></td>${goalie ? `<td>${num(p.stats.gp)}</td><td>${num(p.stats.w)}</td><td>${num(p.stats.l)}</td><td>${num(p.stats.ga)}</td><td>${num(p.stats.sv)}</td><td class="stat-accent">${pct(p.stats.sv_pct)}</td><td>${p.stats.gaa == null ? '—' : two.format(p.stats.gaa)}</td><td>${num(p.stats.so)}</td>` : `<td>${num(p.stats.gp)}</td><td>${num(p.stats.g)}</td><td>${num(p.stats.a)}</td><td class="stat-accent">${num(p.stats.pts)}</td><td>${p.stats.pm == null ? '—' : p.stats.pm > 0 ? `+${p.stats.pm}` : p.stats.pm}</td><td>${num(p.stats.pim)}</td><td>${formatIceTime(p.stats.toi_avg)}</td>`}</tr>`).join('');
  $('players-content').innerHTML = `<div class="panel data-table-scroll"><table class="players-table"><thead><tr><th>№</th><th class="player-name-heading">Игрок</th>${columns}</tr></thead><tbody>${rows || `<tr><td colspan="${goalie ? 10 : 9}" class="table-message">Игроки не найдены</td></tr>`}</tbody></table></div><p class="legend">Показатели за сезон для игроков состава. ${goalie ? '% ОБ — процент отражённых бросков; КН — коэффициент надёжности; СИ — сухие игры.' : 'О — голы + передачи; Вр/И — среднее время на льду, минуты:секунды.'} Отсутствующие значения обозначены «—».</p>`;
}
function renderAll() {
  const logo = safeImage(team()?.image || hub.context?.catalog?.seasons.flatMap(s => s.teams).find(t => Number(t.id) === CLUB_ID)?.image);
  if (logo) { $('club-logo').src = logo; $('club-logo').hidden = false; $('club-monogram').hidden = true; }
  renderStatus(); renderOverview(); renderCalendar(); renderPlayers();
}
function applyRoute() {
  const view = location.hash.replace(/^#/, '').split('?')[0];
  hub.route = ['overview', 'calendar', 'players', 'table'].includes(view) ? view : 'overview';
  document.querySelectorAll('.hub-view').forEach(panel => { panel.hidden = panel.id !== `view-${hub.route}`; });
  document.querySelectorAll('.main-nav a').forEach(link => {
    if (link.dataset.view === hub.route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = hub.route === 'table' ? 'Таблица КХЛ · Автомобилист' : hub.route === 'calendar' ? 'Календарь · Автомобилист' : hub.route === 'players' ? 'Игроки · Автомобилист' : 'Автомобилист · КХЛ';
  renderAll();
  if (hub.route !== 'table') ensureBundle();
}
function onSeason(context) {
  const changed = context.season?.season !== season()?.season;
  hub.context = context;
  if (!context.season) return;
  if (changed) {
    hub.loadController?.abort();
    Object.assign(hub, { bundle: null, loading: false, error: '', month: null });

  }
  applyRoute();
}
async function ensureBundle(force = false) {
  if (!season() || !team() || !season().stageId) { renderAll(); return; }
  if (hub.loading && !force) return;
  const current = season(), key = current.season;
  const cached = hub.bundle || cachedBundle(key, current.stageId);
  const ttl = current.season === hub.context.catalog.expected ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  if (!force && cached && cached.gamesLoaded && cached.playersLoaded && !Object.keys(cached.errors || {}).length && Date.now() - cached.fetchedAt < ttl) { hub.bundle = cached; renderAll(); return; }
  hub.loadController?.abort();
  const controller = new AbortController(); hub.loadController = controller;
  if (cached) hub.bundle = cached;
  hub.loading = true; hub.error = ''; renderAll();
  try {
    const result = await loadBundle(current, { signal: controller.signal, onUpdate: bundle => { if (!controller.signal.aborted && season()?.season === key) { hub.bundle = bundle; renderAll(); } } });
    if (!controller.signal.aborted && season()?.season === key) hub.bundle = result;
  } catch (error) { if (!controller.signal.aborted) hub.error = 'Не удалось загрузить данные команды. Нажмите «Обновить», чтобы повторить.'; }
  finally { if (!controller.signal.aborted && season()?.season === key) { hub.loading = false; renderAll(); } }
}
document.addEventListener('khl:season', event => onSeason(event.detail));
window.addEventListener('hashchange', applyRoute);
$('refresh').addEventListener('click', () => { if (hub.route !== 'table') ensureBundle(true); });
$('player-search').addEventListener('input', event => { hub.playerSearch = event.target.value.trim(); renderPlayers(); });
$('calendar-prev').addEventListener('click', () => changeMonth(-1));
$('calendar-next').addEventListener('click', () => changeMonth(1));
function changeMonth(amount) { if (!hub.month) return; const [year, month] = hub.month.split('-').map(Number), date = new Date(Date.UTC(year, month - 1 + amount, 1)); hub.month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; renderCalendar(); }
$('calendar-nearest').addEventListener('click', () => { const game = focusGame(); if (game?.startsAt) { hub.month = dateKey(game.startsAt).slice(0, 7); renderCalendar(); } });
document.addEventListener('click', event => {
  const mode = event.target.closest('[data-calendar-mode]'); if (mode) { hub.calendarMode = mode.dataset.calendarMode; renderCalendar(); }
  const venue = event.target.closest('[data-venue]'); if (venue) { hub.venue = venue.dataset.venue; renderCalendar(); }
  const group = event.target.closest('[data-player-group]'); if (group) { hub.playerGroup = group.dataset.playerGroup; hub.playerSort = hub.playerGroup === 'goalies' ? 'sv_pct' : 'pts'; hub.playerDirection = 'desc'; renderPlayers(); }
  const role = event.target.closest('[data-player-role]'); if (role) { hub.playerRole = role.dataset.playerRole; renderPlayers(); }
  const sort = event.target.closest('[data-player-sort] button'); if (sort) { const key = sort.parentElement.dataset.playerSort; hub.playerDirection = hub.playerSort === key ? hub.playerDirection === 'desc' ? 'asc' : 'desc' : 'desc'; hub.playerSort = key; renderPlayers(); }
  if (event.target.closest('[data-retry-season]')) ensureBundle(true);
});
document.addEventListener('error', event => { const image = event.target; if (image instanceof HTMLImageElement && image.parentElement?.dataset.fallback) image.parentElement.textContent = image.parentElement.dataset.fallback; }, true);
onSeason(selectedData());
applyRoute();
