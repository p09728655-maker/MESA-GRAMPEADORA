// ════════════════════════════════════════════════════════
// Hora a Hora · Mesa Grampeadora de Painel — Apps Script (backend)
// Patrimar Móveis · Jaci/SP
// ════════════════════════════════════════════════════════
//
// PAPEL: este script é o ÚNICO ponto de contato entre a planilha (fonte da
//        verdade) e o dashboard. O dashboard NÃO escreve nada — só chama
//        `getDashboard` (JSONP) e recebe config + produtos + apontamentos do
//        dia. Toda a matemática de metas/semáforo é feita no dashboard, para
//        que a regra fique num lugar só e visível (ver `index.html`).
//
// CONFIGURAR 1 VEZ:
//   1. Cole este arquivo no editor de Apps Script. Funciona de duas formas:
//        • STANDALONE (script.google.com) — usa SHEET_ID abaixo (já preenchido).
//        • LIGADO à planilha (Extensões ▸ Apps Script) — deixe SHEET_ID vazio.
//   2. Configurações do projeto ▸ Fuso horário = (GMT-03:00) America/Sao_Paulo.
//      O filtro "apontamentos de hoje" usa o fuso do PROJETO.
//   3. Implantar ▸ Nova implantação ▸ App da Web:
//        Executar como = Eu · Quem tem acesso = Qualquer pessoa.
//      Autorize o acesso à planilha quando for pedido.
//      Copie a URL /exec e cole em CFG.SHEETS_URL no dashboard (ou use ?url=).
//   4. Sempre que MUDAR este arquivo, é preciso RE-IMPLANTAR (Gerenciar
//      implantações ▸ editar ▸ Nova versão). Trocar dados na planilha NÃO
//      exige re-deploy — só mudanças de código aqui.
//
// AUTO-PROVISIONAMENTO: na 1ª leitura, se as abas não existirem, o script as
//   cria com cabeçalho e valores padrão (produtos grande=9 / menor=7 e a
//   config-base). Assim o setor começa a operar sem montar planilha na mão.
// ════════════════════════════════════════════════════════

// ID da planilha GRAMPEADORA. Assim o script funciona tanto LIGADO à planilha
// (Extensões ▸ Apps Script) quanto STANDALONE (criado pelo script.google.com).
// Se um dia trocar de planilha, é só mudar este ID e re-implantar.
const SHEET_ID = '1vZpuiwnbaotM4b73VX5HjJtodiigFUhpfjQkKWUT5fQ';

const SHEET_APONT    = 'apontamentos';
const SHEET_PRODUTOS = 'produtos';
const SHEET_CONFIG   = 'config';

// Abre a planilha por ID; cai para a ativa se o ID estiver vazio (modo ligado).
function getSS_(){
  if(SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  return SpreadsheetApp.getActive();
}

// Config-base criada na 1ª vez. O setor ajusta na planilha, sem redeploy.
const CONFIG_PADRAO = [
  ['chave',              'valor'],
  ['meta_batidas_hora',  1250],            // meta-mãe (lastro do cabeçote), já com eficiência
  ['fator_eficiencia',   0.85],            // informativo; ver nota no dashboard
  ['turno_inicio',       '06:00'],         // PREENCHER conforme o turno real
  ['turno_fim',          '15:48'],         // PREENCHER
  ['pausas',             '09:00-09:10;12:00-13:00'], // PREENCHER — faixas descontadas da meta
  ['verde_min',          1.00],            // >=100% da meta acumulada
  ['amarelo_min',        0.85]             // 85–99%
];

// Produtos-exemplo. O dashboard cruza `produto` do apontamento com esta aba
// para saber quantas batidas cada painel consome.
const PRODUTOS_PADRAO = [
  ['produto', 'batidas', 'descricao'],
  ['GRANDE',  9,          'Painel grande — 9 batidas'],
  ['MENOR',   7,          'Painel menor — 7 batidas']
];

// ── Roteamento JSONP ──────────────────────────────────────
function doGet(e){
  const p  = (e && e.parameter) || {};
  const cb = p.callback;
  const action = p.action || 'getDashboard';
  let out;
  try{
    if(action === 'getDashboard')      out = getDashboard();
    else if(action === 'getProdutos')  out = { ok:true, produtos: lerProdutos_(getSS_()) };
    else if(action === 'addApontamento') out = addApontamento_(p);
    else if(action === 'ping')         out = { ok:true, pong:true, ts:agoraMin_() };
    else                               out = { ok:false, erro:'Ação desconhecida: '+action };
  }catch(err){
    out = { ok:false, erro:String((err && err.message) || err) };
  }
  return reply_(out, cb);
}

function reply_(obj, cb){
  const json = JSON.stringify(obj);
  if(cb){
    return ContentService.createTextOutput(cb+'('+json+')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Ação principal ────────────────────────────────────────
function getDashboard(){
  const ss = getSS_();
  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';

  const config   = lerConfig_(ss);
  const produtos = lerProdutos_(ss);
  const apont    = lerApontamentosHoje_(ss, tz);

  return {
    ok: true,
    planilha: ss.getName(),
    data: Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy'),
    serverMin: agoraMin_(),                 // minutos desde a meia-noite (referência/debug)
    config: config,
    produtos: produtos,
    apontamentos: apont                     // [{m, produto, qtd}] — só de hoje
  };
}

// ── Escrita: grava 1 apontamento (chamado pelo app de apontamento) ──
// 1 linha por painel concluído. O timestamp é carimbado aqui (fonte única).
// LockService evita corrida entre os dois lados da mesa apontando ao mesmo tempo.
function addApontamento_(p){
  const produto = String((p && p.produto) || '').trim();
  if(!produto) return { ok:false, erro:'produto vazio' };
  const qtd = Math.max(1, Math.round(Number(p.qtd)||1));
  const op  = String((p && p.op) || '').trim();

  const lock = LockService.getScriptLock();
  try{ lock.waitLock(15000); }catch(e){ return { ok:false, erro:'ocupado, tente de novo' }; }
  try{
    const ss = getSS_();
    const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
    let sh = ss.getSheetByName(SHEET_APONT);
    if(!sh){
      sh = ss.insertSheet(SHEET_APONT);
      sh.getRange(1,1,1,4).setValues([['timestamp','op','produto','qtd_paineis']]);
    }
    const now = new Date();
    // Monta a linha respeitando a ordem do cabeçalho (tolerante a reordenação).
    const width = Math.max(4, sh.getLastColumn());
    const head = sh.getRange(1,1,1,width).getValues()[0].map(h=>String(h||'').trim().toLowerCase());
    if(head.indexOf('produto') < 0){
      sh.appendRow([now, op, produto, qtd]);          // cabeçalho inesperado: usa ordem padrão
    } else {
      const row = new Array(width).fill('');
      for(let c=0;c<width;c++){
        const n = head[c]||'';
        if(n.indexOf('timestamp')>=0 || n==='data' || n==='datahora') row[c]=now;
        else if(n==='op') row[c]=op;
        else if(n==='produto') row[c]=produto;
        else if(n.indexOf('qtd')>=0 || n==='quantidade' || n==='paineis') row[c]=qtd;
      }
      sh.appendRow(row);
    }
    return {
      ok:true, produto:produto, qtd:qtd,
      totalHoje: totalPaineisHoje_(ss, tz),
      hora: Utilities.formatDate(now, tz, 'HH:mm')
    };
  } finally {
    lock.releaseLock();
  }
}

// Soma de qtd_paineis apontados hoje (feedback para o operador).
function totalPaineisHoje_(ss, tz){
  const arr = lerApontamentosHoje_(ss, tz);
  let s=0; arr.forEach(a=>{ s += Number(a.qtd)||1; });
  return s;
}

// ── Leitura da aba config (chave/valor) ───────────────────
function lerConfig_(ss){
  let sh = ss.getSheetByName(SHEET_CONFIG);
  if(!sh){
    sh = ss.insertSheet(SHEET_CONFIG);
    sh.getRange(1,1,CONFIG_PADRAO.length,2).setValues(CONFIG_PADRAO);
  }
  const vals = sh.getDataRange().getValues();
  const cfg = {};
  for(let i=1;i<vals.length;i++){
    const k = String(vals[i][0]||'').trim();
    if(!k) continue;
    cfg[k] = vals[i][1];
  }
  return cfg;
}

// ── Leitura da aba produtos (produto → batidas) ───────────
function lerProdutos_(ss){
  let sh = ss.getSheetByName(SHEET_PRODUTOS);
  if(!sh){
    sh = ss.insertSheet(SHEET_PRODUTOS);
    sh.getRange(1,1,PRODUTOS_PADRAO.length,3).setValues(PRODUTOS_PADRAO);
  }
  const vals = sh.getDataRange().getValues();
  const map = {};
  for(let i=1;i<vals.length;i++){
    const prod = String(vals[i][0]||'').trim();
    if(!prod) continue;
    const batidas = Number(vals[i][1]) || 0;
    map[prod] = { batidas: batidas, descricao: String(vals[i][2]||'') };
  }
  return map;
}

// ── Leitura dos apontamentos de HOJE ──────────────────────
// Devolve compacto: minutos-desde-a-meia-noite (m), produto e qtd_paineis.
// Assim o dashboard só faz bucketing por faixa, sem parsear datas.
function lerApontamentosHoje_(ss, tz){
  let sh = ss.getSheetByName(SHEET_APONT);
  if(!sh){
    sh = ss.insertSheet(SHEET_APONT);
    sh.getRange(1,1,1,4).setValues([['timestamp','op','produto','qtd_paineis']]);
    return [];
  }
  const vals = sh.getDataRange().getValues();
  if(vals.length < 2) return [];

  // Descobre as colunas pelo cabeçalho (tolerante a reordenação).
  const head = vals[0].map(h => String(h||'').trim().toLowerCase());
  const cTs  = idxDe_(head, ['timestamp','data','datahora']);
  const cPr  = idxDe_(head, ['produto']);
  const cQt  = idxDe_(head, ['qtd_paineis','qtd','quantidade','paineis']);
  if(cTs < 0 || cPr < 0) return [];

  const hojeStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const out = [];
  for(let i=1;i<vals.length;i++){
    const ts = vals[i][cTs];
    const d  = paraData_(ts, tz);
    if(!d) continue;
    if(Utilities.formatDate(d, tz, 'yyyy-MM-dd') !== hojeStr) continue;

    const m = Number(Utilities.formatDate(d, tz, 'H'))*60 + Number(Utilities.formatDate(d, tz, 'm'));
    const produto = String(vals[i][cPr]||'').trim();
    if(!produto) continue;
    const qtd = cQt >= 0 ? (Number(vals[i][cQt]) || 1) : 1;
    out.push({ m: m, produto: produto, qtd: qtd });
  }
  return out;
}

// ── Utilidades ────────────────────────────────────────────
function idxDe_(head, nomes){
  for(let n=0;n<nomes.length;n++){
    const i = head.indexOf(nomes[n]);
    if(i >= 0) return i;
  }
  return -1;
}

// Converte a célula de timestamp em Date. Aceita objeto Date (célula de data)
// ou string ISO / "dd/MM/yyyy HH:mm". Retorna null se não der para interpretar.
function paraData_(ts, tz){
  if(ts instanceof Date && !isNaN(ts)) return ts;
  const s = String(ts||'').trim();
  if(!s) return null;
  // ISO (2026-07-22T08:15:00...) — o construtor de Date entende.
  let d = new Date(s);
  if(!isNaN(d)) return d;
  // dd/MM/yyyy HH:mm
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[ T]+(\d{1,2}):(\d{2})/);
  if(m){
    const y = m[3].length === 2 ? 2000+Number(m[3]) : Number(m[3]);
    d = new Date(y, Number(m[2])-1, Number(m[1]), Number(m[4]), Number(m[5]));
    if(!isNaN(d)) return d;
  }
  return null;
}

function agoraMin_(){
  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const now = new Date();
  return Number(Utilities.formatDate(now, tz, 'H'))*60 + Number(Utilities.formatDate(now, tz, 'm'));
}
