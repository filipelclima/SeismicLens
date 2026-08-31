# SeismicLens

Dashboard de monitoramento da Seismic blockchain testnet — a privacy-enabled EVM L1 (nodes rodando dentro de TEEs Intel TDX, shielded storage, transações encriptadas tipo `0x4A`). Modelado a partir do [ArcPulse](https://github.com/filipelclima/ArcPulse) (monitor equivalente para a Arc testnet).

- **GitHub:** https://github.com/filipelclima/SeismicLens
- **Deploy:** https://seismic-lens.vercel.app (Vercel, Framework Preset: Next.js, ver `vercel.json`). Ver `.env.example` para as env vars necessárias.
- **Rede monitorada:** Seismic Testnet — chain ID `5124`, RPC HTTPS `https://testnet-1.seismictest.net/rpc`, RPC WSS `wss://testnet-1.seismictest.net/ws`, explorer `https://seismic-testnet.socialscan.io`. Config centralizada em `src/lib/chain.ts`.
- **Docs da Seismic:** https://docs.seismic.systems

## Stack

- Next.js `14.2.35` (o pin original era `14.2.3`, mas trazia uma CVE crítica sinalizada pelo `npm audit` — sempre checar `npm audit` antes de fixar a versão de uma dependência nova). Ainda restam 2 vulnerabilidades "high" no `npm audit` cujo único fix é Next.js 16 (major, breaking) — decisão de upgrade fica para quando o projeto for atualizado deliberadamente para Next 15/16, não como parte deste scaffold inicial.
- @supabase/supabase-js `2.107.0` (coleta de snapshots)
- recharts `2.12.7` (gráficos)
- Tailwind CSS

## Estrutura

- `src/lib/chain.ts` — RPC HTTPS/WSS, chain ID, explorer URL, tipo de tx shielded (`0x4A`)
- `src/app/page.tsx` — dashboard principal (abas: Dashboard, Reports, Compare, Anomalies, Network Status, Dev Dashboard, Networks, Shielded Activity)
- `src/app/DevDashboard.tsx` — aba Dev Dashboard (Connect Wallet via `window.ethereum` — MetaMask/Rabby/qualquer EIP-1193)
- `src/app/useSeismicData.ts` — hook de leitura ao vivo da chain (bloco atual, gas, latência RPC)
- API routes:
  - `/api/collect` — protegida por `CRON_SECRET` (ver seção própria abaixo), faz scrape da RPC, calcula health score, insere snapshot no Supabase, envia alertas no Discord em transições de anomalia
  - `/api/report` — gera relatório semanal via Anthropic API a partir dos snapshots de um dia
  - `/api/public-stats` — API pública somente-leitura (CORS aberto) sobre os snapshots coletados

## Particularidades da Seismic (vs. Arc/EVM padrão)

- **Existem DOIS mecanismos de privacidade independentes na Seismic — não confundir nem somar as contagens dos dois:**
  1. **Transação shielded = tipo `0x4A`.** Calldata é encriptada client-side (ECDH + AEAD) e só é decriptada dentro da TEE do node. Detecção é sempre por `tx.type`, nunca por endereço de contrato — diferente do "Memo Activity" do ArcPulse, que rastreava um único contrato conhecido. Ver `SHIELDED_TX_TYPE` em `src/lib/chain.ts`. **Não existe forma indexada de filtrar por `tx.type` nessa RPC** (`eth_getLogs` não se aplica ao tipo do envelope da tx, só a eventos de contrato) — a única forma de achar esses txs é varredura bloco-a-bloco (`eth_getBlockByNumber` com `true`), 1 chamada RPC por bloco. Confirmado ao vivo: existe atividade real tipo `0x4A` na rede, mas foi encontrada ~19 dias / ~6.5M blocos atrás, não perto do topo da chain — nenhuma janela de varredura viável no navegador do visitante chega tão longe; a varredura só serve pra pegar atividade NOVA daqui pra frente.
  2. **Transferência de valor oculto via evento SRC20 customizado** — token SUSDC (`SUSDC_CONTRACT` em `src/lib/chain.ts`) emite um evento de transfer que omite o valor (tópico `SRC20_TRANSFER_TOPIC`), numa transação comum tipo `0x0`, sem calldata encriptada. Achado via `eth_getLogs` (query indexada, não bloco-a-bloco) — muito mais barato de cobrir uma janela grande (ver `GET_LOGS_MAX_RANGE = 100_000`, o teto real dessa RPC por chamada).
     - **Categorização de remetente em 3 vias, não 2** (`categorizeSrc20Sender` em `src/lib/src20.ts`, tipo `Src20SenderCategory = 'faucet' | 'faucet-infra' | 'peer'`): `SUSDC_FAUCET_DISPENSER` é o disperser original; `SUSDC_FAUCET_INFRA_CONTRACTS` (`src/lib/chain.ts`) são OUTROS deployments confirmados do mesmo `SeismicFaucet.sol` (mesmo operador, não orgânicos) — hoje só `0xf3a173b11536acea7c6f7536085ab66cda6e901c` (versão nova, com `transferExact`/machine-funding) e `0xaffa83ee0a59f9e0c472385ea6cd0ce48d69778c` (versão antiga, só `drip`). Verificado por: bytecode contém 8-11 dos 11 selectors de `SeismicFaucet.sol` (`github.com/SeismicSystems/faucet`, branch `seismic`); `susdc()` aponta pro mesmo `SUSDC_CONTRACT`; `approvedOperators`/`superOperators` (via `eth_call`) registram o mesmo operador (`0xeb036d5fe3f841661c9e5d7bdcabd493fd86d177`) que já opera o disperser original; todo `tx.from` amostrado no histórico completo de cada contrato é esse mesmo operador; um dos dois tem esse operador literalmente como `Contract Creator` on-chain. **Antes de adicionar um novo endereço a `SUSDC_FAUCET_INFRA_CONTRACTS`, repetir essa verificação** — não é um filtro de conveniência, é uma lista de contratos com prova on-chain de serem infraestrutura oficial do faucet, uma por uma.
     - **`categorizeSrc20Sender` NÃO exclui o endereço zero** (`0x000...000`, padrão de evento de mint) — ele ainda cai em `'peer'`. Não confundir "peer-to-peer" com "todo mundo que não é faucet conhecido": mint events e contratos não identificados também caem nesse balde.
     - Nenhuma transferência peer-to-peer genuína confirmada até agora — por isso a UI sempre separa as 3 categorias em vez de reportar um total, que seria facilmente lido como adoção orgânica.
     - **O contrato SUSDC emite esse evento DUAS VEZES por transferência real, com log byte-a-byte idêntico** (mesmo `address`, `topics`, `data` — só o `logIndex` difere). Confirmado varrendo os 2.146 logs de uma janela de 5.000.000 blocos: são exatamente 1.073 transações, e **100% delas** têm exatamente 2 logs idênticos, sem exceção (nenhuma tx com 1, 3 ou mais). `fetchSrc20Transfers` em `src/app/page.tsx` deduplica por `transactionHash` antes de contar (`count`, `faucetCount`, `peerToPeerCount`) — sem essa dedupe, todo contador vem inflado 2x. `uniqueSenders`/`uniqueRecipients` não são afetados (já vinham de um `Set`, que já colapsa os duplicados). Qualquer novo código que leia esses logs diretamente (em vez de usar `fetchSrc20Transfers`) precisa aplicar a mesma dedupe — é fácil cair na mesma armadilha indexando esse token pela primeira vez.
  - Ambos aparecem na aba **Shielded Activity** (`ShieldedActivityTab` em `src/app/page.tsx`), em seções visualmente separadas, cada uma com seu próprio loading/estado — **nunca aguardar os dois juntos** (ex. via `Promise.all` compartilhado): a varredura 0x4A pode levar bem mais de um minuto, e travar o resultado do `eth_getLogs` (que volta em segundos) atrás disso faz a aba inteira parecer travada.
  - **Janela de varredura 0x4A:** duas velocidades, não uma. `TYPE_4A_AUTO_SCAN_RANGE` (2.000 blocos, ~18s) roda automaticamente ao abrir a aba; `TYPE_4A_WIDE_SCAN_RANGE` (10.000 blocos, ~1-2min) só roda sob demanda via botão, com o custo em RPC calls avisado na UI antes do clique. **Direção correta de longo prazo (registrada, não implementada ainda):** mover essa varredura pro `/api/collect` (que já roda a cada 30min via GitHub Actions), escaneando só o delta de blocos desde a última coleta e persistindo a contagem acumulada no Supabase — a cobertura cresce composta ao longo do tempo sem custo de RPC pro visitante, ao contrário de qualquer varredura client-side. Ressalva de implementação: ~7.200 blocos por janela de 30min ≈ 65-100s de varredura, arriscando estourar o timeout de função serverless da Vercel — precisaria de um cursor retomável (escanear até K blocos por invocação, carregar o resto pra próxima).
- **Gas é pago em SIZE** (18 decimais; ver `NATIVE_CURRENCY` em `src/lib/chain.ts`), não em USDC como na Arc — todo cálculo de saldo/custo usa `/1e18`, não `/1e6`. Nunca hardcodear "ETH" em texto de UI/prompt — sempre referenciar `NATIVE_CURRENCY.symbol`.
- **Bloco é sub-segundo** (consenso Summit), mas `block.timestamp` continua em segundos inteiros — médias de block time usam janelas largas (10-50 blocos) para suavizar a quantização, exatamente como o ArcPulse já fazia para a Arc.
- **Sem faucet público documentado.** A aba Network Status substitui o "Circle Faucet Status" do ArcPulse por um monitor de transporte RPC (HTTPS + WSS), já que a Seismic expõe os dois e não há faucet-status conhecido para checar.
- **Sem Multicall3/Chainlink confirmados no testnet.** As abas "Batch Transactions" e "Chainlink Monitor" do ArcPulse (que dependem de endereços de contrato específicos da Arc) foram **propositalmente omitidas** — não inventar endereços de contrato para a Seismic sem confirmar na documentação/explorer primeiro.

## Regras de trabalho

1. **Sempre rodar os testes unitários existentes antes de fazer commit.**
2. **Sempre escrever testes novos para features novas ou correções de bugs.**
3. **Sempre atualizar este CLAUDE.md após mudanças significativas.**
4. **Manter dependências fixadas em versões exatas** (sem `^` ou `~`) ao adicionar ou atualizar pacotes.
5. **Nunca usar atalhos que escondem erros** (`ignoreBuildErrors`, `@ts-nocheck`, etc.) — sempre corrigir a causa raiz.
6. **Nunca inventar endereços de contrato, URLs de faucet ou métricas da Seismic** — confirmar em `docs.seismic.systems` ou no explorer antes de adicionar qualquer feature que dependa disso.

## Testes

- Vitest `4.1.10` + Testing Library, ambiente `jsdom`. Config em `vitest.config.mts` / `vitest.setup.mts` — extensão `.mts` de propósito (mesmo motivo do ArcPulse: o `tsconfig.json` inclui `**/*.ts`/`**/*.tsx` sem exclusão de testes, e `.mts` não bate nesse glob, isolando a config de teste do build de produção).
- Ainda não há teste de exemplo escrito — ao adicionar a próxima feature ou correção, exportar as funções puras relevantes de `page.tsx` (`toCSV`, `exportCSV`, `exportJSON`, `calcScore`, etc.) e escrever o primeiro teste real ali.

## Coleta de snapshots — /api/collect

`/api/collect` exige `Authorization: Bearer ${CRON_SECRET}` — sem o header certo, retorna 401. Duas coisas chamam essa rota, cada uma autenticando de um jeito:

- **Cron do Vercel** (`vercel.json`, 1x/dia — plano Hobby não permite mais frequente): o próprio Vercel injeta automaticamente o header `Authorization: Bearer ${CRON_SECRET}` em toda invocação de um Cron Job, lendo o valor da env var `CRON_SECRET` do projeto — isso é convenção nativa do Vercel, não precisa de código extra pra isso funcionar, só a env var precisa existir no projeto.
- **GitHub Actions** (`.github/workflows/collect.yml`, a cada 30min + `workflow_dispatch` manual) — é o trigger principal, já que o cron do Vercel sozinho é frequência baixa demais pra gerar histórico útil. Chama a URL de produção via `curl` com o mesmo `CRON_SECRET`, lido de secret do repositório (nunca hardcoded). Falha visivelmente (`exit 1` + `::error::`) se a resposta não for 200.

**Env vars/secrets necessários** (mesmo valor de `CRON_SECRET` nos dois lugares):
- Vercel (Project Settings → Environment Variables): `CRON_SECRET`
- GitHub (repo Settings → Secrets and variables → Actions): `CRON_SECRET` e `PRODUCTION_URL` (a URL base de produção, sem `/api/collect` no final)

`process.env.CRON_SECRET` ausente faz a rota sempre retornar 401 (fail closed) — não confundir com bug se esquecer de configurar a env var no Vercel antes do primeiro deploy pós-mudança.

**SRC20 delta scan** (`scanSrc20Delta` em `route.ts`) roda em paralelo com a varredura de 50 blocos do 0x4A, e escreve `src20_transfer_count` — mecanismo independente, nunca somado com `shielded_tx_count` (mesma regra do resto do app). Usa `eth_getLogs`, então é barato mesmo cobrindo um delta grande. **Cursor: reaproveita `block_number` da snapshot anterior** (`fromBlock = prevBlockNumber + 1`) em vez de uma coluna nova — o `toBlock` do scan já é o mesmo `latest` que vira `block_number` da linha atual, então não há necessidade de rastrear esse estado separadamente. Deduplicado via `dedupeSrc20Logs` (`src/lib/src20.ts`, compartilhado com `page.tsx` — ver nota de double-emission acima). Capado em `SRC20_COLLECT_MAX_CHUNKS = 20` chunks (2M blocos); se o delta desde a última coleta for maior que isso (gap de coleta longo), só a parte mais recente é varrida e um alerta no Discord avisa que houve um buraco não preenchido — sem isso, uma falha longa no cron faria uma única invocação tentar escanear milhões de blocos e estourar o timeout de função serverless da Vercel.

## Setup do Supabase

Projeto novo: rodar `supabase/schema.sql` uma vez no SQL editor antes do primeiro deploy — cria a tabela `network_snapshots` com RLS (leitura pública, escrita só via service key).

Projeto existente (schema já aplicado antes de uma mudança de coluna): rodar os arquivos em `supabase/migrations/` em ordem — `schema.sql` não é idempotente para colunas novas, é só a baseline de instalação limpa.

## Comandos

```bash
npm run dev      # dev server
npm run build    # build de produção
npm test         # roda a suíte de testes (vitest run)
npx tsc --noEmit # typecheck isolado
```
