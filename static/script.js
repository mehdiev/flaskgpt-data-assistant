"use strict";
const $ = selector => document.querySelector(selector);
let current = null, busy = false;
let selectedSources = new Set();
const csrf = $('meta[name="csrf-token"]').content;
function el(tag, text, cls) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
function showError(error) { $('#error').textContent = error.message || String(error); $('#error').hidden = false; }
function clearError() { $('#error').hidden = true; }
async function api(path, options = {}) {
  const headers = {'X-CSRF-Token': csrf, ...options.headers};
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {...options, headers});
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Erreur serveur (${response.status}).`); }
  return response;
}
function lock(value) {
  busy = value;
  document.querySelectorAll('button,input,select,textarea').forEach(n => { n.disabled = value; });
  $('#status').textContent = value ? 'Traitement en cours…' : 'Prêt';
  $('#messages').setAttribute('aria-busy', String(value));
}
async function action(fn) {
  if (busy) return;
  clearError(); lock(true);
  try { await fn(); } catch (error) { showError(error); }
  finally { lock(false); }
}
async function history() {
  const items = await (await api('/api/conversations')).json();
  $('#history').replaceChildren(...items.map(c => { const n = el('option', c.title); n.value = c.id; return n; }));
  if (current) $('#history').value = current.id;
  return items;
}
async function load(id, reset = false) {
  current = await (await api(`/api/conversations/${id}`)).json();
  if (reset) selectedSources = new Set();
  render(); await history();
}
async function createConversation() {
  current = await (await api('/api/conversations', {method:'POST',body:JSON.stringify({domain:$('#domain').value,specialty:$('#specialty').value})})).json();
  selectedSources.clear(); render(); await history(); $('#prompt').value = '';
}
function renderText(container, text, refs, mid) {
  const pattern = /\[(S\d+:L\d+)\]/g;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(position, match.index)));
    const ref = refs.find(r => r.key === match[1]);
    if (ref) {
      const a = el('a', match[0], 'citation'); a.href = `#ref-${mid}-${ref.key.replace(':','-')}`;
      a.addEventListener('click', () => { const target = document.getElementById(a.hash.slice(1)); if (target) target.closest('details').open = true; });
      container.append(a);
    } else container.append(document.createTextNode(match[0]));
    position = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(position)));
}
function messageNode(m) {
  const card = el('article', null, `message ${m.role} ${m.rating ? 'rating-'+m.rating : ''}`);
  card.append(el('div', m.role === 'user' ? 'Vous' : 'Assistant', 'role'));
  const body = el('div', null, 'message-body'); renderText(body, m.content, m.sources || [], m.id); card.append(body);
  if (m.role === 'assistant' && m.id) {
    const ratings = el('div', null, 'ratings'); ratings.setAttribute('aria-label','Évaluer cette réponse');
    ['Insuffisante', 'Moyenne', 'Satisfaisante'].forEach((label, i) => {
      const b = el('button', `${i+1}/3 · ${label}`, `r${i+1}`); b.type = 'button'; b.setAttribute('aria-pressed', String(m.rating === i+1));
      b.addEventListener('click', () => action(async () => { await api(`/api/conversations/${current.id}/messages/${m.id}/rating`, {method:'PATCH',body:JSON.stringify({rating:i+1})}); await load(current.id); }));
      ratings.append(b);
    }); card.append(ratings);
    if (m.sources.length) {
      const details = el('details'); details.append(el('summary',`${m.sources.length} passages transmis — ouvrir pour vérifier les citations`));
      m.sources.forEach(ref => { const block = el('div', null, 'passage'); block.id = `ref-${m.id}-${ref.key.replace(':','-')}`;
        block.append(el('strong', `[${ref.key}] ${ref.name} · lignes ${ref.start}–${ref.end}${ref.truncated ? ' · passage tronqué à 1 500 caractères' : ''}`),el('pre',ref.text)); details.append(block); });
      card.append(details);
    } else card.append(el('p','Aucune source externe transmise pour cette réponse.', 'muted'));
  }
  return card;
}
function render() {
  $('#title').textContent = current.title; $('#domain').value = current.domain; $('#specialty').value = current.specialty;
  $('#messages').replaceChildren(...(current.messages.length ? current.messages.map(messageNode) : [el('p','Choisissez un domaine, importez vos sources puis commencez une conversation.', 'empty')]));
  const sources = $('#sources'); sources.replaceChildren();
  current.sources.forEach(source => {
    const block = el('div', null, 'source'), label = el('label'), input = el('input'); input.type = 'checkbox'; input.checked = selectedSources.has(source.id);
    input.addEventListener('change', () => input.checked ? selectedSources.add(source.id) : selectedSources.delete(source.id));
    label.append(input,document.createTextNode(source.name)); block.append(label);
    const remove = el('button','Retirer','secondary'); remove.addEventListener('click', () => action(async () => { await api(`/api/conversations/${current.id}/sources/${source.id}`,{method:'DELETE'}); selectedSources.delete(source.id); await load(current.id); })); block.append(remove); sources.append(block);
  });
  renderMetrics(); renderQuality();
}
function renderMetrics() {
  const runs = current.runs, success = runs.filter(r => r.status === 'success');
  const known = runs.filter(r => r.total_tokens != null);
  const rated = current.messages.filter(m => m.rating);
  const values = [[runs.length, 'Requêtes, résumés inclus'],[success.length ? (success.reduce((s,r)=>s+r.seconds,0)/success.length).toFixed(2)+' s' : '—','Durée moyenne réussie'],[known.length ? known.reduce((s,r)=>s+r.total_tokens,0).toLocaleString('fr-FR') : 'n.d.',`Tokens connus (${known.length}/${runs.length} requêtes)`],[rated.length ? (rated.reduce((s,m)=>s+m.rating,0)/rated.length).toFixed(1)+'/3' : '—',`Note utilisateur (${rated.length} réponses)`]];
  $('#metrics').replaceChildren(...values.map(([v,l])=>{const n=el('div',null,'metric');n.append(el('strong',v),el('span',l));return n;}));
  $('#runs').replaceChildren(...runs.map((r,i)=>{const tr=el('tr');const m=current.messages.find(x=>x.id===r.message);[`${i+1} · ${r.kind==='summary'?'Résumé':'Réponse'} / ${r.model}`, {success:'Réussie',error:'Échec',cancelled:'Interrompue'}[r.status] || r.status,r.seconds.toFixed(2)+' s',r.first_token==null?'—':r.first_token.toFixed(2)+' s',r.input_tokens??'n.d.',r.output_tokens??'n.d.',r.total_tokens??'n.d.',m?.rating ? m.rating+'/3':'—'].forEach(v=>tr.append(el('td',String(v))));return tr;}));
}
function renderQuality() {
  const panel = $('#quality'); panel.replaceChildren();
  const datasets = current.sources.filter(s => s.report);
  if (!datasets.length) { panel.append(el('p','Importez une base SQLite ou un CSV pour consulter ses indicateurs.','muted')); return; }
  datasets.forEach(source => {
    const report = source.report, block = el('div',null,'report'); block.append(el('h3',source.name),el('p',report.scope,'muted'),el('p',report.compliance,'muted'));
    if (report.foreign_key_violations != null) block.append(el('p',`Violations de clés étrangères déclarées : ${report.foreign_key_violations}`));
    report.tables.forEach(t => {
      block.append(el('h3',`${t.table} · ${t.rows_analyzed} lignes · ${t.columns} colonnes`));
      block.append(el('p',`Complétude : ${t.completeness_pct ?? 'n.d.'} % · Unicité des lignes : ${t.uniqueness_pct ?? 'n.d.'} %`));
      block.append(el('p',`${t.missing} valeurs manquantes · ${t.duplicates} doublons · ${t.numeric_inconsistencies} incohérences numériques · ${t.potential_outliers} anomalies potentielles`));
      if(t.duplicate_row_examples?.length)block.append(el('p',`Exemples de lignes en doublon : ${t.duplicate_row_examples.join(', ')} (numéros hors en-tête).`,'muted'));
      if (t.not_null_violations != null) block.append(el('p',`Violations NOT NULL déclarées : ${t.not_null_violations}`));
      const details=el('details');details.append(el('summary','Détail par colonne'),el('pre',JSON.stringify(t.details,null,2)));block.append(details);
    });
    const details=el('details'); details.append(el('summary','Configurer les règles métier (JSON)'));
    const label=el('label','Règles par nom de colonne — appliquées à chaque table');
    const input=el('textarea'); input.rows=5; input.value=JSON.stringify(report.business_rules?.rules || {age:{required:true,min:0,max:120}},null,2);label.append(input);
    details.append(label,el('p','Exemple : {"statut":{"allowed":["actif","inactif"]}}. Les valeurs CSV sont des textes. Une colonne absente est signalée.','muted'));
    const button=el('button','Vérifier les règles','secondary');button.addEventListener('click',()=>action(async()=>{let rules;try{rules=JSON.parse(input.value);}catch{throw new Error('Les règles doivent contenir du JSON valide.');}await api(`/api/conversations/${current.id}/sources/${source.id}/rules`,{method:'POST',body:JSON.stringify({rules})});await load(current.id);}));details.append(button);block.append(details);
    if(report.business_rules)block.append(el('h3','Résultats des règles métier'),el('pre',JSON.stringify(report.business_rules.results,null,2)));
    panel.append(block);
  });
}
async function download(response, name) {
  const blob=await response.blob(), url=URL.createObjectURL(blob), a=el('a'); a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function send() {
  const text=$('#prompt').value.trim();if(!text)return;
  const id=current.id;
  const optimistic=messageNode({role:'user',content:text,sources:[]});$('#messages .empty')?.remove();$('#messages').append(optimistic);
  const answer=messageNode({role:'assistant',content:'',sources:[]});$('#messages').append(answer);
  let reader, completed=false;
  try {
    const response=await api('/prompt',{method:'POST',body:JSON.stringify({conversation_id:id,message:text,sources:[...selectedSources],mode:$('#mode').value,count:Number($('#count').value)})});
    reader=response.body.getReader();const decoder=new TextDecoder();let buffer='', content='';
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let cut;
      while((cut=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const type=frame.match(/^event: (.+)$/m)?.[1];const raw=frame.match(/^data: (.+)$/m)?.[1];if(!raw)continue;const data=JSON.parse(raw);
        if(type==='error')throw new Error(data.error);
        if(type==='done')completed=true;
        if(type==='delta'){content+=data.text;answer.querySelector('.message-body').textContent=content;$('#messages').scrollTop=$('#messages').scrollHeight;}
      }if(done)break;
    }
    if(!completed)throw new Error('La connexion a été interrompue. Réessayez.');
    $('#prompt').value='';
  } finally {
    if(reader)reader.releaseLock();
    await load(id); // Une réponse partielle n’est jamais présentée comme une réponse sauvegardée.
  }
}
$('#new').addEventListener('click',()=>action(createConversation));
$('#clear').addEventListener('click',()=>{if(current && confirm('Supprimer définitivement cette conversation, ses sources et ses évaluations ?'))action(async()=>{await api(`/api/conversations/${current.id}`,{method:'DELETE'});await createConversation();});});
$('#history').addEventListener('change',()=>action(()=>load($('#history').value,true)));
$('#domain-save').addEventListener('click',()=>action(async()=>{await api(`/api/conversations/${current.id}`,{method:'PATCH',body:JSON.stringify({domain:$('#domain').value,specialty:$('#specialty').value})});await load(current.id);}));
$('#prompt-form').addEventListener('submit',event=>{event.preventDefault();action(send);});
$('#upload').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const form=new FormData();form.append('file',$('#file').files[0]);const before=new Set(current.sources.map(s=>s.id));current=await(await api(`/api/conversations/${current.id}/sources`,{method:'POST',body:form})).json();current.sources.filter(s=>!before.has(s.id)).forEach(s=>selectedSources.add(s.id));render();$('#file').value='';});});
document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',()=>action(async()=>{const format=button.dataset.export;await download(await api(`/api/conversations/${current.id}/export/${format}`),`conversation.${format}`);})));
$('#summary').addEventListener('click',()=>action(async()=>{try{await download(await api(`/api/conversations/${current.id}/summary`,{method:'POST'}),'resume.pdf');}finally{await load(current.id);}}));
action(async()=>{const items=await history();if(items.length)await load(items[0].id,true);else await createConversation();});
