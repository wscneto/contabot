'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const media = url => typeof url === 'string' && url.startsWith('/media/') ? esc(url) : '';
const state = {config:null, skus:[], videos:[], video:null, editing:null, timer:null, route:0};
const statusText = {processing:'Processando', completed:'Contagem sugerida', needs_review:'Confira o resultado', no_matches:'Nenhum produto identificado', failed:'Não foi possível analisar'};
const dateLabel = value => new Date(value).toLocaleString('pt-BR', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const badge = status => `<span class="badge ${esc(status)}">${esc(statusText[status] || status)}</span>`;

async function api(path, options = {}) {
  if (options.body && !(options.body instanceof FormData)) { options.headers = {'Content-Type':'application/json'}; options.body = JSON.stringify(options.body); }
  let response;
  try { response = await fetch(path, options); } catch { throw new Error('Não foi possível conectar. Confira a conexão e tente novamente.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Não foi possível concluir. Confira os arquivos e tente novamente.');
  return data;
}
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 4500);
}
function renderCount() {
  return `<h1>Conte seus produtos pelo vídeo.</h1><p class="lead">Envie uma filmagem. O ContaBot reconhece os produtos cadastrados e sugere as quantidades.</p>
    <section class="panel">${state.skus.length ? `<form id="video-form"><label class="field upload-field">Escolha um vídeo<input name="video" type="file" accept="video/*,.mov,.mkv" required><small>Vídeo do celular · até ${esc(state.config.max_upload_mb)} MB</small></label><p class="capture-help">Filme uma área curta, devagar, com todas as caixas visíveis. Evite voltar sobre o mesmo trecho.</p><div class="actions"><button class="btn" type="submit">Contar produtos <span aria-hidden="true">→</span></button></div><div class="form-error" role="alert"></div></form>` : '<div class="empty"><p>Primeiro, adicione fotos dos produtos que deseja reconhecer.</p><a class="btn" href="#catalog">Cadastrar produtos →</a></div>'}</section>
    <div class="section-heading"><h2>Seus vídeos</h2></div><div class="video-list">${state.videos.length ? state.videos.map(v => `<a class="video-card" href="#video/${encodeURIComponent(v.id)}"><span><span class="video-name">${esc(v.filename)}</span><small>${esc(dateLabel(v.created_at))}${v.simulated ? ' · Simulado' : ''}</small></span>${badge(v.status)}</a>`).join('') : '<p class="empty">Os resultados aparecem aqui depois do primeiro vídeo.</p>'}</div>`;
}
function renderCatalog() {
  const editing = state.skus.find(s => s.id === state.editing);
  const name = editing ? [editing.name, editing.variant].filter(Boolean).join(' · ') : '';
  return `<h1>Meus produtos</h1><p class="lead">Uma foto da embalagem ajuda o ContaBot a reconhecer cada produto.</p>
    <section class="panel"><h2>${editing ? 'Editar produto' : 'Adicionar produto'}</h2><form id="sku-form" class="catalog-form" data-edit-id="${esc(editing?.id || '')}"><label class="field">Nome do produto / SKU<input name="name" required maxlength="160" value="${esc(name)}" placeholder="Ex.: Língua de Gato ao leite · 85 g" autocomplete="off"></label><label class="field">Fotos da embalagem<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple${editing ? '' : ' required'}><small>${editing ? 'Envie novas fotos para substituir as atuais ou deixe vazio para mantê-las.' : 'De 1 a 4 fotos nítidas, até 10 MB cada.'}</small></label><div class="actions"><button class="btn" type="submit">${editing ? 'Salvar alterações' : 'Salvar produto'}</button>${editing ? '<a href="#catalog">Cancelar</a>' : ''}</div><div class="form-error" role="alert"></div></form></section>
    <div class="section-heading"><h2>Produtos cadastrados</h2>${state.skus.length ? '<a href="#count" class="muted">Contar por vídeo →</a>' : ''}</div>
    ${state.skus.length ? `<div class="products">${state.skus.map(s => `<article class="product"><a href="${media(s.photos?.[0])}" target="_blank" rel="noopener"><img src="${media(s.photos?.[0])}" alt="Foto de ${esc(s.name)}" loading="lazy"></a><div><strong>${esc(s.name)}</strong><small>${s.photos.length} ${s.photos.length === 1 ? 'foto' : 'fotos'}${s.variant ? ` · ${esc(s.variant)}` : ''}</small><div class="product-actions"><button class="text-button" type="button" data-edit-sku="${esc(s.id)}" aria-label="Editar ${esc(s.name)}">Editar</button><button class="text-button delete-button" type="button" data-delete-sku="${esc(s.id)}" aria-label="Excluir ${esc(s.name)}">Excluir</button></div></div></article>`).join('')}</div>` : '<p class="empty">Nenhum produto cadastrado ainda.</p>'}`;
}
function resultRow(result) {
  const corrected = result.confirmed_quantity != null;
  const quantity = corrected ? result.confirmed_quantity : result.quantity;
  const unit = quantity === 1 ? 'unidade' : 'unidades';
  const visible = quantity == null ? 'Não foi possível contar' : `<strong>${quantity}</strong> ${unit}${result.incomplete ? (quantity === 1 ? ' visível' : ' visíveis') : ''}`;
  const singleFrame = state.video.prediction?.overlap_resolved === false && result.quantity != null && result.evidence_frame_ids?.length === 1;
  const frame = singleFrame && state.video.frames.find(f => f.id === result.evidence_frame_ids[0]);
  const scope = result.incomplete && quantity != null ? `<span class="count-scope">Contagem parcial${frame ? ` · <a href="${media(frame.url)}" target="_blank" rel="noopener">Neste frame</a>` : ''}</span>` : '';
  return `<div class="result-row"><a href="${media(result.photo)}" target="_blank" rel="noopener" aria-label="Ver foto de ${esc(result.name || result.sku_id)}"><img class="result-photo" src="${media(result.photo)}" alt="" loading="lazy"></a><div><h2>${esc(result.name || result.sku_id)}</h2><p class="result-quantity">${visible}</p>${scope}${corrected ? `<span class="original">Conferido por você · sugestão: ${result.quantity == null ? 'desconhecida' : result.quantity}</span>` : ''}${result.incomplete || result.needs_review ? `<p class="result-note">${esc(result.reason || 'Confira a quantidade: nem todas as unidades estão claras.')}</p>` : ''}</div><label class="correction">${corrected ? 'Conferido' : 'Corrigir'}<input type="number" min="0" step="1" inputmode="numeric" data-sku="${esc(result.sku_id)}" aria-label="Quantidade conferida de ${esc(result.name || result.sku_id)}" value="${corrected ? result.confirmed_quantity : ''}" placeholder="—"></label></div>`;
}
function renderVideo() {
  const v = state.video;
  const frames = v.frames || [];
  const evidence = [...new Set((v.results || []).flatMap(r => r.evidence_frame_ids || []))];
  const shownFrames = evidence.length ? frames.filter(f => evidence.includes(f.id)) : frames;
  const noMatchReasons = [...new Set((v.identification?.matches || []).map(match => match.reason).filter(Boolean))].slice(0, 3).join(' ');
  const reviewNotice = (v.results || []).some(r => r.incomplete) ? '<strong>Contagem parcial.</strong> As quantidades mostram apenas as unidades visíveis. Confira as imagens ou filme novamente para completar.' : 'Confira a identificação dos produtos e as quantidades sugeridas.';
  const stage = {frames:'Escolhendo imagens…', identifying:'Reconhecendo produtos…', counting:'Contando unidades…'}[v.stage] || 'Preparando a contagem…';
  const description = v.status === 'processing' ? 'O resultado aparece automaticamente quando estiver pronto.' : ['failed', 'no_matches'].includes(v.status) ? 'Confira as imagens e tente novamente com os produtos visíveis.' : 'Confira as quantidades sugeridas antes de usar a contagem.';
  return `<a class="back" href="#count">← Seus vídeos</a><div class="result-heading"><div><h1>${esc(v.filename)}</h1><p class="muted">${description}</p></div>${badge(v.status)}</div>
    ${v.simulated && !state.config.simulated ? '<div class="notice simulation"><strong>Resultado simulado.</strong> Estas quantidades são fictícias.</div>' : ''}
    <section class="panel">${v.status === 'processing' ? `<div class="processing" role="status"><span class="spinner" aria-hidden="true"></span><div><strong>${stage}</strong><small>Você pode continuar usando o ContaBot.</small></div></div>` : v.status === 'failed' ? `<div class="notice danger" role="alert">${esc(v.error || 'Não foi possível analisar este vídeo. Tente novamente ou envie outra filmagem.')}</div><button class="btn secondary" id="retry-button">Tentar novamente</button>` : v.status === 'no_matches' ? `<h2>Nenhum produto cadastrado foi identificado</h2><p class="muted">Isso não significa que a quantidade seja zero. Confira as fotos dos produtos ou tente um vídeo mais nítido.</p>${noMatchReasons ? `<p class="result-note">${esc(noMatchReasons)}</p>` : ''}<div class="actions"><a class="btn" href="#count">Enviar outro vídeo</a><a href="#catalog">Ver meus produtos</a><button class="btn secondary" id="retry-button">Tentar novamente</button></div>` : `<form id="counts-form">${v.status === 'needs_review' ? `<div class="notice">${reviewNotice}</div>` : ''}<div class="results">${(v.results || []).map(resultRow).join('')}</div>${(v.results || []).length ? '<div class="actions"><button class="btn secondary" type="submit">Salvar correções</button><button class="text-button" id="retry-button" type="button">Tentar novamente</button><a href="#count" class="muted">Contar outro vídeo →</a></div><p class="result-help">Preencha só as quantidades que você conferiu.</p><div class="form-error" role="alert"></div>' : '<p class="empty">Nenhuma contagem disponível para este vídeo.</p>'}</form>`}
    ${v.unknown_products?.length ? `<p class="result-note">Outros produtos não identificados: ${v.unknown_products.map(esc).join('; ')}.</p>` : ''}
    ${shownFrames.length && v.status !== 'processing' ? `<details class="evidence"><summary>Ver imagens</summary><div class="frames">${shownFrames.map(f => `<a href="${media(f.url)}" target="_blank" rel="noopener"><img src="${media(f.url)}" alt="Imagem usada na contagem, aos ${Number(f.timestamp_seconds || 0).toFixed(1)} segundos" loading="lazy">${Number(f.timestamp_seconds || 0).toFixed(1).replace('.', ',')} s</a>`).join('')}</div></details>` : ''}</section>`;
}
function render(view) {
  $$('[data-nav]').forEach(el => { if (el.dataset.nav === (view === 'catalog' ? 'catalog' : 'count')) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  $('#app').innerHTML = view === 'catalog' ? renderCatalog() : view === 'video' ? renderVideo() : renderCount();
}
async function pollVideo(id, route) {
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    try {
      const video = await api(`/api/videos/${encodeURIComponent(id)}`);
      if (route !== state.route) return;
      state.video = video; render('video');
      if (video.status === 'processing') pollVideo(id, route);
    } catch (error) { if (route === state.route) { toast(error.message, true); pollVideo(id, route); } }
  }, 1500);
}
async function route() {
  const current = ++state.route; state.editing = null; clearTimeout(state.timer); window.scrollTo({top:0});
  const hash = location.hash.slice(1) || 'count';
  try {
    if (hash.startsWith('video/')) {
      const video = await api(`/api/videos/${encodeURIComponent(decodeURIComponent(hash.slice(6)))}`);
      if (current !== state.route) return;
      state.video = video; render('video'); if (video.status === 'processing') pollVideo(video.id, current);
    } else {
      const [skus, videos] = await Promise.all([api('/api/skus'), api('/api/videos')]);
      if (current !== state.route) return;
      state.skus = skus; state.videos = videos; render(hash === 'catalog' ? 'catalog' : 'count');
    }
  } catch (error) { if (current === state.route) $('#app').innerHTML = `<div class="notice danger" role="alert">${esc(error.message)}</div><a class="btn secondary" href="#count">Voltar aos vídeos</a>`; }
}
async function run(form, message, action) {
  const button = $('button[type=submit]', form) || form;
  const error = $('.form-error', form); if (error) error.textContent = '';
  const label = button.textContent; button.disabled = true; button.textContent = message;
  try { await action(); } catch (err) { if (error?.isConnected) error.textContent = err.message; else toast(err.message, true); }
  finally { if (button.isConnected) { button.disabled = false; button.textContent = label; } }
}

document.addEventListener('submit', event => {
  const form = event.target; if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'sku-form') return run(form, 'Salvando…', async () => {
    const current = state.route;
    const files = form.elements.namedItem('photos').files;
    if (files.length > 4 || [...files].some(f => f.size > 10 * 1024 * 1024)) throw new Error('Escolha de 1 a 4 fotos de até 10 MB cada.');
    const id = form.dataset.editId; const data = new FormData(form);
    if (!files.length) data.delete('photos');
    await api(id ? `/api/skus/${encodeURIComponent(id)}` : '/api/skus', {method:id ? 'PATCH' : 'POST',body:data});
    if (current === state.route) await route(); toast(id ? 'Produto atualizado.' : 'Produto cadastrado.');
  });
  if (form.id === 'video-form') return run(form, 'Enviando vídeo…', async () => {
    const current = state.route;
    const file = form.elements.namedItem('video').files[0];
    if (file.size > state.config.max_upload_mb * 1024 * 1024) throw new Error(`O vídeo deve ter até ${state.config.max_upload_mb} MB.`);
    const video = await api('/api/videos', {method:'POST',body:new FormData(form)});
    if (current === state.route) location.hash = `video/${encodeURIComponent(video.id)}`;
    else toast('Vídeo enviado. Veja o resultado em Contar produtos.');
  });
  if (form.id === 'counts-form') return run(form, 'Salvando…', async () => {
    const current = state.route;
    const counts = Object.fromEntries($$('[data-sku]', form).map(input => [input.dataset.sku, input.value === '' ? null : Number(input.value)]));
    if (Object.values(counts).some(n => n !== null && (!Number.isSafeInteger(n) || n < 0))) throw new Error('Use quantidades inteiras, a partir de zero.');
    const video = await api(`/api/videos/${encodeURIComponent(state.video.id)}/counts`, {method:'PATCH',body:{counts}});
    if (current === state.route) { state.video = video; render('video'); } toast('Correções salvas.');
  });
});
document.addEventListener('click', event => {
  const remove = event.target.closest('[data-delete-sku]');
  if (remove) {
    const sku = state.skus.find(s => s.id === remove.dataset.deleteSku);
    if (!sku || !window.confirm(`Excluir “${sku.name}” do catálogo? As contagens anteriores continuam salvas.`)) return;
    return run(remove, 'Excluindo…', async () => {
      const current = state.route;
      await api(`/api/skus/${encodeURIComponent(sku.id)}`, {method:'DELETE'});
      state.skus = state.skus.filter(s => s.id !== sku.id);
      if (state.editing === sku.id) state.editing = null;
      if (current === state.route) await route(); toast('Produto excluído.');
    });
  }
  const edit = event.target.closest('[data-edit-sku]');
  if (edit) { state.editing = edit.dataset.editSku; ++state.route; render('catalog'); window.scrollTo({top:0}); $('#sku-form [name=name]').focus(); return; }
  const link = event.target.closest('a[href^="#"]');
  if (link && link.hash === location.hash) { event.preventDefault(); route(); }
  const button = event.target.closest('#retry-button');
  if (button) run(button, 'Tentando novamente…', async () => {
    const current = state.route;
    await api(`/api/videos/${encodeURIComponent(state.video.id)}/retry`, {method:'POST'});
    if (current === state.route) await route(); else toast('Nova análise iniciada. Veja o resultado em Contar produtos.');
  });
});
window.addEventListener('hashchange', route);
(async () => {
  try {
    state.config = await api('/api/config');
    $('#provider-label').textContent = state.config.simulated ? 'Simulação' : `${state.config.provider === 'codex' ? 'ChatGPT' : 'Modelo visual'}${state.config.model ? ` · ${state.config.model}` : ''}`;
    $('#simulation-banner').hidden = !state.config.simulated;
    await route();
  } catch (error) { $('#app').innerHTML = `<div class="notice danger" role="alert">${esc(error.message)}</div>`; }
})();
