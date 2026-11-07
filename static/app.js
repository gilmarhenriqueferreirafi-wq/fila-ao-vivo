const $ = (selector) => document.querySelector(selector);
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = '/static/favicon.svg';
document.head.appendChild(favicon);
const queueStyles = document.createElement('link');
queueStyles.rel = 'stylesheet';
queueStyles.href = '/static/queue.css';
document.head.appendChild(queueStyles);
let lastState = null;
let activeTrackKey = null;
let ytPlayer = null;
let ytApiReady = false;
let endRequestFor = null;
let availableQualities = [];
let miniPlayback = null;

async function api(path, options = {}) {
  const response = await fetch(path, {headers: {'Content-Type': 'application/json'}, ...options});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Algo deu errado');
  return body;
}

function recordConfigHistory(category, values) {
  api('/api/history', {method: 'POST', body: JSON.stringify({category, values})}).catch(() => {});
}

function reportPlaybackProgress() {
  if (!ytPlayer || !lastState || typeof ytPlayer.getCurrentTime !== 'function') return;
  const item = lastState.queue[lastState.current];
  if (!item) return;
  try {
    const current = Number(ytPlayer.getCurrentTime()) || 0;
    const duration = Number(ytPlayer.getDuration()) || 0;
    const playing = typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    if (!duration) return;
    api('/api/progress', {method: 'POST', body: JSON.stringify({track_id: item.id, current, duration, playing})}).catch(() => {});
  } catch (error) {
    // O player ainda não está pronto; a próxima chamada tenta novamente.
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

function itemMarkup(item, index, options = {}) {
  const removable = Boolean(options.removable);
  const reorderable = Boolean(options.reorderable);
  const selectable = options.selectable !== false;
  const by = item.added_by ? ` · por ${escapeHtml(item.added_by)}` : '';
  const controls = reorderable ? `<div class="reorder-controls"><button class="move-up" data-index="${index}" aria-label="Mover para cima" ${index === 0 ? 'disabled' : ''}>↑</button><button class="move-down" data-index="${index}" aria-label="Mover para baixo" ${index === lastState.queue.length - 1 ? 'disabled' : ''}>↓</button></div>` : '';
  const active = lastState.current === index ? ' active' : '';
  return `<article class="queue-item${active}${selectable ? ' selectable' : ''}" data-select-index="${selectable ? index : ''}"${reorderable ? ' draggable="true"' : ''}><img src="${item.thumbnail}" alt=""><div class="item-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.channel || 'YouTube')}${by}</small></div>${controls}${removable ? `<button class="remove" data-index="${index}" aria-label="Remover">×</button>` : ''}</article>`;
}

function playerKey(item) {
  return item ? item.id : null;
}

function mountCurrentTrack() {
  if (!ytApiReady || !lastState || !$('#player')) return;
  const item = lastState.queue[lastState.current];
  const key = playerKey(item, lastState.current);
  if (!item) {
    if (ytPlayer) ytPlayer.destroy();
    ytPlayer = null;
    activeTrackKey = null;
    $('#player').innerHTML = '<div class="player-empty">Adicione uma música para começar</div>';
    return;
  }
  if (key === activeTrackKey) return;
  activeTrackKey = key;
  endRequestFor = null;
  if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById(item.id);
    setTimeout(updateQualityOptions, 700);
    return;
  }
  $('#player').innerHTML = '<div id="youtube-player"></div>';
  ytPlayer = new YT.Player('youtube-player', {
    videoId: item.id,
    playerVars: {autoplay: 1, playsinline: 1, rel: 0, enablejsapi: 1},
    events: {
      onReady: (event) => { event.target.playVideo(); setTimeout(updateQualityOptions, 300); applyVideoPreferences(); },
      onStateChange: handlePlayerState,
      onError: () => {
        const message = $('#playback-message');
        if (message) message.textContent = 'O YouTube não conseguiu reproduzir este vídeo.';
      },
    },
  });
}

function applyVideoPreferences() {
  const mode = localStorage.getItem('fila-video-mode') || 'video';
  const quality = localStorage.getItem('fila-video-quality') || 'auto';
  $('#player')?.classList.toggle('audio-only', mode === 'audio');
  const audioToggle = $('#audio-only-toggle');
  if (audioToggle) audioToggle.checked = mode === 'audio';
  const qualitySelect = $('#quality-select');
  if (qualitySelect) qualitySelect.value = quality;
  if (ytPlayer && quality !== 'auto' && typeof ytPlayer.setPlaybackQuality === 'function') ytPlayer.setPlaybackQuality(quality);
}

function updateQualityOptions() {
  if (!ytPlayer || typeof ytPlayer.getAvailableQualityLevels !== 'function') return;
  const detected = ytPlayer.getAvailableQualityLevels() || [];
  if (detected.length) availableQualities = [...new Set(detected)];
  const select = $('#quality-select');
  if (!select || !availableQualities.length) return;
  const labels = {highres: '8K / máxima', hd2160: '4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p'};
  const saved = localStorage.getItem('fila-video-quality') || 'auto';
  select.innerHTML = '<option value="auto">Automática</option>' + availableQualities.map((quality) => `<option value="${quality}">${labels[quality] || quality}</option>`).join('');
  select.value = availableQualities.includes(saved) ? saved : 'auto';
  if (saved !== 'auto' && availableQualities.includes(saved) && ytPlayer.setPlaybackQuality) ytPlayer.setPlaybackQuality(saved);
}

function setupVideoControls() {
  if (!document.body.classList.contains('panel') || !$('.player-controls')) return;
  $('.player-controls').insertAdjacentHTML('afterend', '<div class="video-settings"><label><span>Qualidade detectada</span><select id="quality-select"><option value="auto">Automática</option></select></label><label class="audio-toggle"><input id="audio-only-toggle" type="checkbox"><span>Somente áudio</span></label></div>');
  $('#quality-select').addEventListener('change', (event) => { localStorage.setItem('fila-video-quality', event.target.value); recordConfigHistory('video', {quality: event.target.value}); applyVideoPreferences(); });
  $('#audio-only-toggle').addEventListener('change', (event) => { const mode = event.target.checked ? 'audio' : 'video'; localStorage.setItem('fila-video-mode', mode); recordConfigHistory('video', {mode}); applyVideoPreferences(); });
  restoreVideoPreferences().finally(() => applyVideoPreferences());
}

async function restoreVideoPreferences() {
  const hasQuality = localStorage.getItem('fila-video-quality');
  const hasMode = localStorage.getItem('fila-video-mode');
  try {
    const data = await api('/api/history');
    const saved = {};
    (data.history || []).filter((entry) => entry.category === 'video').forEach((entry) => Object.assign(saved, entry.values || {}));
    if (saved.quality) localStorage.setItem('fila-video-quality', saved.quality);
    else if (hasQuality) localStorage.setItem('fila-video-quality', hasQuality);
    if (saved.mode) localStorage.setItem('fila-video-mode', saved.mode);
    else if (hasMode) localStorage.setItem('fila-video-mode', hasMode);
  } catch (error) {
    console.warn('Não foi possível restaurar as preferências de vídeo', error);
  }
}

function setupMiniVideoToggle() {
  if (!document.body.classList.contains('panel') || !$('.player-controls')) return;
  $('.player-controls').insertAdjacentHTML('afterend', '<button class="mini-video-toggle secondary" id="mini-video-toggle" type="button">Mostrar vídeo no /painel</button>');
  $('#mini-video-toggle').addEventListener('click', async () => {
    try {
      render(await api('/api/settings', {method: 'POST', body: JSON.stringify({mini_show_video: !lastState.settings.mini_show_video})}));
    } catch (error) {
      const message = $('#playback-message');
      if (message) message.textContent = error.message;
    }
  });
}

async function handlePlayerState(event) {
  updateMiniProgress();
  if (event.data !== YT.PlayerState.ENDED || !lastState) return;
  const settings = lastState.settings || {};
  if (!settings.auto_play && !settings.random_on_empty) return;
  const endedKey = activeTrackKey;
  if (endRequestFor === endedKey) return;
  endRequestFor = endedKey;
  try {
    const nextState = await api('/api/ended', {method: 'POST', body: '{}'});
    render(nextState);
    if (playerKey(nextState.queue[nextState.current], nextState.current) === endedKey && ytPlayer) {
      endRequestFor = null;
      ytPlayer.seekTo(0, true);
      ytPlayer.playVideo();
    }
  } catch (error) {
    const message = $('#playback-message');
    if (message) message.textContent = error.message;
  }
}

function render(state) {
  lastState = state;
  miniPlayback = state.playback || null;
  document.body.classList.toggle('mini-show-video', Boolean(state.settings?.mini_show_video));
  if ($('#mini-video-toggle')) $('#mini-video-toggle').textContent = state.settings?.mini_show_video ? 'Mostrar capa no /painel' : 'Mostrar vídeo no /painel';
  const queue = state.queue || [];
  const previousQueueIds = knownQueueIds;
  knownQueueIds = queue.map((item) => item.id);
  if (previousQueueIds && knownQueueIds.some((id) => !previousQueueIds.includes(id))) playQueueAlert();
  const settings = state.settings || {};
  if ($('#count')) $('#count').textContent = `${queue.length} ${queue.length === 1 ? 'música' : 'músicas'}`;
  if ($('#queue')) $('#queue').innerHTML = queue.length
    ? queue.map((item, index) => itemMarkup(item, index, {removable: true, reorderable: true})).join('')
    : '<div class="empty">A fila está vazia.<br><span>Use o controle remoto para adicionar.</span></div>';
  if ($('#queue-count')) $('#queue-count').textContent = `${queue.length} ${queue.length === 1 ? 'música' : 'músicas'}`;
  if ($('#mini-list')) $('#mini-list').innerHTML = queue.length
    ? queue.map((item, index) => itemMarkup(item, index, {reorderable: true})).join('')
    : '<div class="hint">Nenhuma música adicionada ainda.</div>';
  if ($('#status-dot')) $('#status-dot').classList.add('on');
  if ($('#now-label')) $('#now-label').textContent = state.current >= 0 ? `#${state.current + 1}` : '—';
  document.querySelectorAll('[data-setting]').forEach((button) => {
    const active = Boolean(settings[button.dataset.setting]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  mountCurrentTrack();
  const miniItem = queue[state.current];
  if ($('#mini-thumbnail')) $('#mini-thumbnail').src = miniItem?.thumbnail || '';
  if ($('#mini-title')) $('#mini-title').textContent = miniItem?.title || 'Nenhuma música tocando';
  if ($('#mini-channel')) $('#mini-channel').textContent = miniItem?.channel || 'A fila está vazia';
}

function updateMiniProgress() {
  if (!$('#mini-progress')) return;
  try {
    let elapsed = 0;
    let duration = 0;
    let playing = false;
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      elapsed = Number(ytPlayer.getCurrentTime()) || 0;
      duration = Number(ytPlayer.getDuration()) || 0;
      playing = typeof ytPlayer.getPlayerState === 'function' && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    }
    if ((!duration || !Number.isFinite(duration)) && miniPlayback) {
      duration = Number(miniPlayback.duration) || 0;
      elapsed = Number(miniPlayback.current) || 0;
      playing = Boolean(miniPlayback.playing);
      if (playing && miniPlayback.updated_at) elapsed += Math.max(0, Date.now() / 1000 - Number(miniPlayback.updated_at));
    }
    if (!duration) return;
    const percent = Math.min(100, (elapsed / duration) * 100);
    $('#mini-progress').style.width = `${percent}%`;
    if ($('#mini-elapsed')) $('#mini-elapsed').textContent = formatTime(elapsed);
    if ($('#mini-duration')) $('#mini-duration').textContent = formatTime(duration);
  } catch (error) {
    // O iframe ainda pode estar carregando; a próxima atualização tenta novamente.
  }
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function setupMiniPanel() {
  const fullscreenButton = $('#fullscreen-btn');
  if (fullscreenButton) {
    fullscreenButton.addEventListener('click', async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      fullscreenButton.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreenButton.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
    });
  }
  setInterval(updateMiniProgress, 500);
}

setInterval(reportPlaybackProgress, 1000);

async function refresh() {
  try { render(await api('/api/state')); }
  catch (error) { console.error(error); }
}

let knownQueueIds = null;
let alertAudio = null;

function unlockAlertAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!alertAudio) alertAudio = new AudioContextClass();
  if (alertAudio.state === 'suspended') alertAudio.resume();
}

function playQueueAlert() {
  if (!alertAudio) return;
  const start = alertAudio.currentTime;
  [880, 1320].forEach((frequency, offset) => {
    const oscillator = alertAudio.createOscillator();
    const gain = alertAudio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.12, start + offset * 0.12 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset * 0.12 + 0.1);
    oscillator.connect(gain).connect(alertAudio.destination);
    oscillator.start(start + offset * 0.12);
    oscillator.stop(start + offset * 0.12 + 0.11);
  });
}

function setupGenrePicker() {
  if (!document.body.classList.contains('panel')) return;
  const topbar = $('.topbar');
  if (!topbar || $('#genre-picker')) return;
  topbar.insertAdjacentHTML('beforeend', `<div class="genre-picker"><button class="genre-toggle" id="genre-toggle" type="button">Gêneros</button><div class="genre-popover" id="genre-picker" hidden><strong>GÊNEROS AUTOMÁTICOS</strong><p>Marque um ou mais estilos para a música surpresa.</p><div id="genre-options"></div><button class="genre-apply" id="genre-apply" type="button">Salvar seleção</button></div></div>`);
  $('#genre-toggle').addEventListener('click', async () => {
    unlockAlertAudio();
    const picker = $('#genre-picker');
    picker.hidden = !picker.hidden;
    if (!picker.hidden && !$('#genre-options').children.length) {
      const data = await api('/api/genres');
      const selected = lastState?.settings?.selected_genres || Object.keys(data.genres);
      $('#genre-options').innerHTML = Object.entries(data.genres).map(([key, genre]) => `<label><input type="checkbox" value="${key}" ${selected.includes(key) ? 'checked' : ''}>${escapeHtml(genre.label)}</label>`).join('');
    }
  });
  $('#genre-apply').addEventListener('click', async () => {
    const selected = [...document.querySelectorAll('#genre-options input:checked')].map((input) => input.value);
    try {
      render(await api('/api/settings', {method: 'POST', body: JSON.stringify({selected_genres: selected})}));
      $('#genre-picker').hidden = true;
    } catch (error) { $('#message, #playback-message').textContent = error.message; }
  });
}

function searchResultsMarkup(results) {
  return results.map((item) => `<article class="result"><img src="${item.thumbnail}" alt=""><div class="item-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.channel)}</small></div><button class="add" data-id="${item.id}" data-title="${escapeHtml(item.title)}" data-channel="${escapeHtml(item.channel)}">+</button></article>`).join('');
}

function moreResultsMarkup(offset) {
  return `<button class="more-results" data-offset="${offset}" type="button">+ Mais músicas</button>`;
}

function setupPanelSearch() {
  const wrap = $('.queue-wrap');
  if (!wrap) return;
  wrap.insertAdjacentHTML('afterbegin', '<form id="panel-search-form" class="panel-search"><input id="panel-search" autocomplete="off" placeholder="Adicionar música pelo PC..." required><button type="submit">Pesquisar</button></form><div id="panel-results" class="results"></div>');
  $('#panel-search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('#panel-search').value.trim();
    if (!query) return;
    $('#panel-results').innerHTML = '<div class="hint loading">Procurando no YouTube…</div>';
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(query) + '&offset=0&limit=10');
      $('#panel-results').innerHTML = data.results.length ? searchResultsMarkup(data.results) + moreResultsMarkup(data.offset + data.results.length) : '<div class="hint">Nenhum resultado encontrado.</div>';
    } catch (error) { $('#panel-results').innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`; }
  });
  $('#panel-results').addEventListener('click', async (event) => {
    const more = event.target.closest('.more-results');
    if (more) {
      const query = $('#panel-search').value.trim();
      more.disabled = true;
      try {
        const data = await api('/api/search?q=' + encodeURIComponent(query) + '&offset=' + more.dataset.offset + '&limit=10');
        more.outerHTML = data.results.length ? searchResultsMarkup(data.results) + moreResultsMarkup(Number(more.dataset.offset) + data.results.length) : '';
      } catch (error) { more.disabled = false; $('#playback-message').textContent = error.message; }
      return;
    }
    const button = event.target.closest('.add');
    if (!button) return;
    button.disabled = true;
    try { await api('/api/queue', {method: 'POST', body: JSON.stringify({id: button.dataset.id, title: button.dataset.title, channel: button.dataset.channel, added_by: 'Painel'})}); button.textContent = '✓'; refresh(); }
    catch (error) { button.disabled = false; $('#playback-message').textContent = error.message; }
  });
}

document.addEventListener('pointerdown', unlockAlertAudio);
setupGenrePicker();
const automaticButton = document.querySelector('[data-setting="random_on_empty"]');
if (automaticButton) {
  const label = automaticButton.querySelector('b');
  const description = automaticButton.querySelector('small');
  if (label) label.textContent = 'Automática BR';
  if (description) description.textContent = 'Buscar ao acabar';
}

window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
  mountCurrentTrack();
};
const youtubeApi = document.createElement('script');
youtubeApi.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(youtubeApi);

if ($('#search-form')) {
  $('#search-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('#search').value.trim();
    if (!query) return;
    $('#results').innerHTML = '<div class="hint loading">Procurando no YouTube…</div>';
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(query) + '&offset=0&limit=10');
      $('#results').innerHTML = data.results.length
        ? searchResultsMarkup(data.results) + moreResultsMarkup(data.offset + data.results.length)
        : '<div class="hint">Nenhum resultado encontrado.</div>';
    } catch (error) {
      $('#results').innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
    }
  });
  $('#results').addEventListener('click', async (event) => {
    const more = event.target.closest('.more-results');
    if (more) {
      const query = $('#search').value.trim();
      more.disabled = true;
      try {
        const data = await api('/api/search?q=' + encodeURIComponent(query) + '&offset=' + more.dataset.offset + '&limit=10');
        more.outerHTML = data.results.length ? searchResultsMarkup(data.results) + moreResultsMarkup(Number(more.dataset.offset) + data.results.length) : '';
      } catch (error) { more.disabled = false; $('#message').textContent = error.message; }
      return;
    }
    const button = event.target.closest('.add');
    if (!button) return;
    button.disabled = true;
    try {
      await api('/api/queue', {method: 'POST', body: JSON.stringify({
        id: button.dataset.id, title: button.dataset.title,
        channel: button.dataset.channel, added_by: 'Celular',
      })});
      button.textContent = '✓';
      button.classList.add('added');
      refresh();
    } catch (error) {
      $('#message').textContent = error.message;
      button.disabled = false;
    }
  });
  $('#mini-list').addEventListener('click', handleQueueAction);
  refresh();
  setInterval(refresh, 3000);
} else if (document.body.classList.contains('mini-panel')) {
  setupMiniPanel();
  refresh();
  setInterval(refresh, 3000);
} else {
  setupPanelSearch();
  setupVideoControls();
  setupMiniVideoToggle();
  $('#next-btn').onclick = async () => {
    try { render(await api('/api/next', {method: 'POST', body: '{}'})); }
    catch (error) { $('#playback-message').textContent = error.message; }
  };
  $('#prev-btn').onclick = async () => {
    try { render(await api('/api/previous', {method: 'POST', body: '{}'})); }
    catch (error) { $('#playback-message').textContent = error.message; }
  };
  $('#clear-btn').onclick = async () => {
    if (confirm('Limpar toda a fila?')) {
      render(await api('/api/clear', {method: 'POST', body: '{}'}));
    }
  };
  $('#queue').addEventListener('click', async (event) => {
    await handleQueueAction(event);
    const button = event.target.closest('.remove');
    if (!button) return;
    render(await api('/api/remove', {method: 'POST', body: JSON.stringify({index: Number(button.dataset.index)})}));
  });
  setupDesktopDrag();
  document.querySelectorAll('[data-setting]').forEach((button) => {
    button.addEventListener('click', async () => {
      const key = button.dataset.setting;
      try {
        render(await api('/api/settings', {method: 'POST', body: JSON.stringify({[key]: !button.classList.contains('active')})}));
        if (key === 'auto_play' && lastState.settings.auto_play && ytPlayer) ytPlayer.playVideo();
        const message = $('#playback-message');
        if (message) message.textContent = '';
      } catch (error) {
        $('#playback-message').textContent = error.message;
      }
    });
  });
  refresh();
  setInterval(refresh, 3000);
}

async function handleQueueAction(event) {
  const move = event.target.closest('.move-up, .move-down');
  const remove = event.target.closest('.remove');
  if (remove) return;
  try {
    if (move) {
      event.stopPropagation();
      const direction = move.classList.contains('move-up') ? -1 : 1;
      render(await api('/api/move', {method: 'POST', body: JSON.stringify({index: Number(move.dataset.index), direction})}));
      return;
    }
    const item = event.target.closest('[data-select-index]');
    if (item) render(await api('/api/select', {method: 'POST', body: JSON.stringify({index: Number(item.dataset.selectIndex)})}));
  } catch (error) {
    const message = $('#playback-message') || $('#message');
    if (message) message.textContent = error.message;
  }
}

function setupDesktopDrag() {
  if (!$('#queue')) return;
  let draggedIndex = null;
  $('#queue').addEventListener('dragstart', (event) => {
    const item = event.target.closest('.queue-item');
    if (!item) return;
    draggedIndex = Number(item.dataset.selectIndex);
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  $('#queue').addEventListener('dragend', (event) => event.target.closest('.queue-item')?.classList.remove('dragging'));
  $('#queue').addEventListener('dragover', (event) => {
    if (event.target.closest('.queue-item')) event.preventDefault();
  });
  $('#queue').addEventListener('drop', async (event) => {
    event.preventDefault();
    const target = event.target.closest('.queue-item');
    const targetIndex = target ? Number(target.dataset.selectIndex) : -1;
    if (draggedIndex === null || targetIndex < 0 || draggedIndex === targetIndex) return;
    const direction = targetIndex > draggedIndex ? 1 : -1;
    try {
      let index = draggedIndex;
      while (index !== targetIndex) {
        render(await api('/api/move', {method: 'POST', body: JSON.stringify({index, direction})}));
        index += direction;
      }
    } catch (error) {
      $('#playback-message').textContent = error.message;
    } finally { draggedIndex = null; }
  });
}
