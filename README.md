# Hora a Hora · Mesa Grampeadora de Painel

Dashboard de ritmo de produção da **Mesa Grampeadora** (Patrimar Móveis · Jaci/SP).
Front-end estático (HTML/JS, arquivo único) que lê um Google Sheets em tempo real
via Google Apps Script (JSONP). Mesmo modelo do painel de Embalagem: a planilha é
o **contrato**, o dashboard **só lê e renderiza** — nunca escreve.

## A meta é em **batidas/hora**, não em painéis

Cada acionamento do cabeçote grampeia **um painel num passe**. A meta-mãe é fixada
em **batidas/hora** (~1.250 = 1.472 teóricas × 0,85 de eficiência). Isso a torna
imune ao mix: o dashboard converte para painéis dividindo pelas batidas do produto
que está rodando (grande = 9 → ~139/h; menor = 7 → ~179/h). **Nunca** chumbar meta
em "painéis".

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | O dashboard (TV/monitor, rota `/`). Todo o cálculo de meta/semáforo vive aqui. |
| `apontar.html` | App de apontamento (celular/tablet, rota `/apontar`). O operador toca a cada painel pronto; grava na aba `apontamentos`. |
| `grampeadora_appscript.gs` | Backend Apps Script — lê (`getDashboard`, `getProdutos`) e grava (`addApontamento`). **Mudar aqui exige re-deploy manual** no editor do Apps Script. |
| `sw-grampeadora.js` | Service worker (network-first) — a tela não cai se a rede piscar. |
| `vercel.json` / `manifest.json` | Deploy Vercel + PWA. |

## Como ligar (1 vez)

1. **Planilha** — crie um Google Sheets para a grampeadora (3 abas: `apontamentos`,
   `produtos`, `config`). Se as abas não existirem, o Apps Script as cria com
   cabeçalho e padrões na 1ª leitura.
2. **Backend** — na planilha: Extensões ▸ Apps Script, cole `grampeadora_appscript.gs`,
   ajuste o fuso do projeto para `America/Sao_Paulo`, e Implantar ▸ App da Web
   (executar como você, acesso "qualquer pessoa"). Copie a URL `…/exec`.
3. **Dashboard** — cole a URL em `CFG.SHEETS_URL` no `index.html` (ou abra a página
   com `?url=<url>`, ou clique na engrenagem ⚙ e cole — vale só na memória da aba).
4. **Deploy** — Vercel na conta `p09728655-maker`, servindo `/` = `index.html`.

## O contrato (schema do Sheets)

- **`apontamentos`** — 1 linha por painel: `timestamp`, `op`, `produto`, `qtd_paineis`.
  O app de apontamento grava só isso; as **batidas não vêm do app**.
- **`produtos`** — de-para `produto` → `batidas` (`descricao` opcional).
- **`config`** — chave/valor: `meta_batidas_hora`, `fator_eficiencia`, `turno_inicio`,
  `turno_fim`, `pausas` (`09:00-09:10;12:00-13:00`), `verde_min`, `amarelo_min`.

> **Meta:** `meta_batidas_hora` é a meta efetiva (já com eficiência). Modo teórico
> opcional: preencha `meta_batidas_teorica` e a meta passa a ser `teórica ×
> fator_eficiencia` — aí mexer no fator recalcula tudo, sem redeploy.

## Lógica (resumo)

- Faixas horárias vêm de `turno_inicio`/`turno_fim`; cada faixa desconta a pausa que
  cair dentro dela: `meta_da_faixa = meta_hora × (min_produtivos / 60)`.
- **Faixa corrente** usa **meta proporcional** ao tempo já decorrido (evita vermelho
  falso às 08:05). Na virada de hora a faixa anterior "congela".
- `aderência = acum_realizado / acum_meta` → **verde** ≥ `verde_min`, **amarelo** ≥
  `amarelo_min`, senão **vermelho**.
- **Resiliência:** se o Sheets não responder, mantém o último dado na tela e sinaliza
  "reconectando" — nunca zera, nunca fica em branco. Estado só em memória (sem
  localStorage).

## Pendências do setor (não bloqueiam o build)

- [ ] Preencher `turno_inicio`, `turno_fim`, `pausas` na aba `config`.
- [ ] Popular `produtos` com todos os painéis e suas batidas (começar grande=9, menor=7).
- [ ] Após 1 semana: revisar o teto real do painel menor com o histórico.

