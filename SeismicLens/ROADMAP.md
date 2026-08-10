# ArcPulse — Roadmap

> Dashboard de monitoramento da Arc blockchain testnet. Builder: HashZero.
> Objetivo: ganhar reputação na comunidade Arc House e conseguir o cargo de Builder/Architect.

## Status atual (última atualização: 07/07/2026, sessão 3)

10 abas em produção: Dashboard, Reports, Compare, Anomalies, Network Status (+ Faucet Tracker),
Dev Dashboard, Networks, Memo Activity, Batch Transactions, **🔗 Chainlink Monitor** (nova).
+ API Pública (`/api/public-stats`) + Alertas Discord (confiabilidade + anomalia de rede).

9 abas em `page.tsx`: Dashboard, Reports (AI Report + Uptime History), Compare, Anomalies,
Network Status (Success Rate + Tx Type Breakdown + RPC Monitor + Gas Estimator), Dev Dashboard
(Connect Wallet via MetaMask/Rabby), Networks (Arc vs Ethereum/Polygon/BNB/Arbitrum), Memo Activity,
**Batch Transactions** (nova).

**Concluído recentemente:**

- **Memo Activity Monitor:** varredura corrigida de 200 → 2000 blocos (sub-1s block time da Arc fazia
  txs "saltarem fora" da janela rápido demais). Trocada amostragem esparsa (20 blocos) por varredura
  completa em lotes de 50 (`MEMO_SCAN_RANGE`, `MEMO_SCAN_BATCH_SIZE` no `page.tsx`). Validado em
  produção com 39 memo txs capturadas corretamente.
- **Memo ID zerado — resolvido:** confirmado via doc oficial (`docs.arc.io/arc/references/contract-addresses`)
  que o endereço USDC na Arc é `0x3600000000000000000000000000000000000000` — exatamente o "Target"
  que aparecia em todas as memo txs. O parsing está correto: o target real é o contrato USDC, porque o
  `send-memo.ts` testa memos anexados a transferências de USDC. O Memo ID sempre zerado é o script de
  teste usando um placeholder fixo, não bug no `page.tsx`.
- **Batch Transactions Monitor (nova aba "📦 Batch Transactions") — concluído e em produção.** Usa o
  contrato oficial `Multicall3From` (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`, confirmado em
  `docs.arc.io/arc/references/contract-addresses` — preserva `msg.sender` via precompile `CallFrom`).
  Decodificação via `viem` (`decodeFunctionData`, ABI padrão do Multicall3:
  `aggregate`/`aggregate3`/`aggregate3Value`) em vez de slicing manual. Mostra: txs em lote, total de
  calls batchadas, contratos mais chamados via batch, gas economizado estimado (~21k gas por call extra
  evitada).
- **Investigação do gap no Uptime History (19-23/06) — causa raiz não 100% confirmada, mas
  infraestrutura corrigida.** Resumo da investigação:
  - Descartado bug de código: `ReportsTab`/Uptime History só lista dias que realmente têm linhas no
    Supabase, sem `LIMIT` e sem criar buracos artificiais.
  - Descoberto e descartado: existia um **projeto Vercel duplicado** (`arc-pulse`, com hífen →
    `arc-pulse-ruddy.vercel.app`), importado por engano em 03/06, com seu próprio cron e env vars do
    Supabase — mas confirmado via teste direto (inserção não apareceu na tabela) que ele escrevia num
    banco Supabase **diferente** (órfão). Não era a causa do gap. Já deletado (ver abaixo).
  - Causa mais provável: cron do Hobby da Vercel não tem retry em caso de falha (confirmado na doc
    oficial), combinado possivelmente com pause por inatividade do Supabase free tier (pausa após 7
    dias sem query real). Logs de execução do cron e da function no Hobby só ficam retidos por 1h — não
    foi possível confirmar forense o que houve especificamente em 19-23/06.
  - **Descoberta importante ao testar a correção:** o problema não era só histórico — entre 24/06 e
    28/06 (4 dias) o cron ficou mudo de novo, sem nenhum snapshot novo. Ou seja, é um problema **crônico**
    da infra free tier, não um incidente isolado.
- **Self-heal + alerta no Discord — implementado e validado em produção (28/06).**
  - Frontend (`page.tsx`, componente `Home`): ao abrir o site, checa há quanto tempo veio o último
    snapshot; se > 26h, dispara `/api/collect` na hora, sem esperar o cron.
  - Backend (`/api/collect/route.ts`): antes de inserir, compara com o último `created_at` existente;
    se o gap > 26h, manda alerta pro Discord via `DISCORD_WEBHOOK_URL` (env var). Se a própria inserção
    falhar, manda alerta de erro também.
  - Validado: ao testar, capturou um gap real de **99.6h** (24/06 → 28/06) e alertou corretamente.
- **Alerta de anomalia de rede no Discord — concluído (28/06).** Reaproveita o mesmo
  `sendDiscordAlert`/`DISCORD_WEBHOOK_URL` do item acima. Compara o estado de anomalia do snapshot
  anterior (`anomaly` no banco) com o atual e alerta só na **transição**: 🔴 quando entra em anomalia
  (com score, block time médio, latência e bloco), ✅ quando volta a saudável. Não espama o canal
  enquanto o problema persiste — 1 aviso no início, 1 na recuperação. Isso fecha os dois itens
  "Webhook/Discord Alert" do roadmap (confiabilidade da coleta + anomalia de rede).
- **Projeto Vercel duplicado `arc-pulse` — deletado (28/06).** Housekeeping concluído.
- **Export de dados CSV/JSON — concluído (30/06).** Botões "⬇ CSV" / "⬇ JSON" reutilizáveis
  (`ExportButtons`, helpers `toCSV`/`exportCSV`/`exportJSON`/`downloadFile` em escopo de módulo).
  Em **Reports**: na barra de filtro (exporta todos os snapshots do período filtrado) e no detalhe do
  dia selecionado (exporta só aquele dia). Em **Compare**: um par de botões por período (A e B),
  exportando os dados brutos de cada um. CSV gerado sem dependência nova, com escape correto de
  vírgulas/aspas/quebras de linha. Botões desabilitados quando não há dados.
- **Faucet Status Tracker — concluído (01/07).** Nova rota `/api/faucet-status` (server-side,
  `force-dynamic`) + card "💧 Circle Faucet Status" no topo da aba Network Status. Três estados:
  🟢 Online (2xx + latência), 🟡 Reachable com bloqueio (4xx — bot protection comum em IPs de
  datacenter, não significa fora do ar), 🔴 Offline (timeout/sem resposta). Detalhe importante: testado
  e confirmado que `faucet.circle.com` retorna 403 pra IPs de cloud/datacenter (incluindo Vercel
  serverless) — um monitor simples verde/vermelho mostraria falso positivo permanente de "OFFLINE".
  A versão atual distingue os 3 estados e explica ao usuário o que cada um significa.
- **API Pública `/api/public-stats` — concluída (01/07).** Rota read-only, unauthenticated, CORS
  aberto (`*`), cache de 5min. Três endpoints: `summary` (agregados 7d + 30d: block time, gas price,
  latência RPC, health score, tx count, anomaly count), `latest` (snapshot mais recente), `snapshots`
  (dados brutos paginados, params `limit` até 100 e `days` até 30). Usa `ANON_KEY` (não a
  `SERVICE_KEY`) — princípio de menor privilégio. Autodocumentada via campo `meta` em cada resposta.
  Validado em produção: `{"ok":true,"endpoint":"summary","last_7d":{"snapshots":9,"avg_health_score":96},...}`
- **Chainlink/CCIP Monitor — concluído (03/07).** Nova aba "🔗 Chainlink" monitorando os contratos
  do Chainlink Scale (anunciado em 30/06). Verifica via `typeAndVersion()` e `isCursed()` se o CCIP
  Router e ARM Proxy estão ativos, mostra o Chain Selector oficial da Arc (`3034092155422581607`),
  lista todos os endereços de contrato com links pro block explorer, e escaneia os últimos 1000 blocos
  em busca de txs enviadas ao CCIP Router. Validado em produção: Router 1.2.0 ativo, ARMProxy 1.0.0
  respondendo, 0 txs CCIP (Arc entrou no Scale em 30/06 — dashboard pronto pra capturar quando
  começar atividade). Fix necessário pós-deploy: ARM `isCursed()` retornava `0x` vazio sendo
  interpretado como `null` (Unknown) em vez de `false` (Active) — corrigido inferindo status pela
  versão do contrato.
- **SRE: alertas por severidade distintos — concluído (05/07).** Aplicando Google SRE Workbook:
  4 casos distintos no Discord: 🟡 WARNING (score 50-69, "monitora, sem ação imediata"), 🔴 CRITICAL
  (score <50, "atenção imediata"), 🚨 ESCALATED (warning→critical, "situação piorando"), ✅ recovered
  (com contexto de qual severidade saiu). Busca também `anomaly_severity` do snapshot anterior pra
  detectar escalada de severidade como evento separado.
- **Cron externo via cron-job.org — configurado (07/07).** Terceira camada de confiabilidade de
  coleta além do cron da Vercel (meia-noite UTC, sem retry no Hobby) e do self-heal do frontend.
  cron-job.org chama `/api/collect` às 9:00 UTC todo dia — tem histórico de execuções com status HTTP
  que o Vercel Hobby não oferece. Com duas chamadas automáticas/dia + self-heal, gaps de coleta de
  múltiplos dias devem ser eliminados.

**Pendências abertas:**
- Localizar e limpar o projeto Supabase órfão associado ao `arc-pulse` (free tier permite só 2
  projetos ativos) — o projeto Vercel já foi deletado, mas o banco órfão pode ainda existir do lado do
  Supabase.
- Confirmar nos próximos dias se o cron da Vercel "voltou a funcionar" sozinho ou se vai continuar
  falhando (nesse caso, o self-heal cobre o buraco toda vez que alguém visita o site, mas o ideal seria
  o cron funcionar de verdade).
- Considerar trocar a varredura do Memo Activity por `eth_getLogs` (mais eficiente que varrer 2000
  blocos) — doc oficial confirma que o contrato Memo "emits `Memo` events with a sequential index".
  Ainda não implementado para não arriscar quebrar o que já foi validado em produção.
- Confirmar decodificação do Multicall3From com uma batch tx real (ainda não testado contra a RPC ao
  vivo — sandbox de desenvolvimento não tem acesso à RPC da Arc).

## Arc Ecosystem Watch (log de novidades do Discord/Arc)

> HashZero cola aqui resumos de anúncios do Discord da Arc entre sessões, pra manter qualquer chat
> novo atualizado sem precisar reexplicar tudo.

- **31/07/2026 — Circle Agent Stack: auto-update.** Circle lançou auto-update para o Circle Agent
  Stack (o CLI/tooling usado para construir agentes que integram com produtos Circle/Arc, ex.
  ERC-8004/x402 mencionados na entrada da Vyper acima):
  - `circle update` — atualiza o CLI (requer v0.0.6+)
  - `circle skill update --tool claude-code` — atualiza Circle Skills com os últimos patterns
  Docs: developers.circle.com/agent-stack.
  **Relevância pro ArcPulse:** é update de tooling de dev, não uma feature/produto na Arc em si —
  ainda não usamos o Circle Agent Stack diretamente no projeto. Vale re-visitar se a ideia futura de
  aba "Agent Activity" (ver entrada da Vyper acima) sair do papel, já que esse CLI provavelmente é o
  caminho recomendado pela Circle para automatizar esse tipo de integração. Só anotado por enquanto.

- **26/06/2026 — Vyper on Arc (agentic payments).** Spotlight da Arc sobre o trabalho da Vyper
  (linguagem Pythonic para EVM, framework Titanoboa) na Arc Testnet combinando três camadas: identidade
  (registro/validação/reputação de agentes via **ERC-8004**), liquidação (fluxos **x402** + Circle Gateway
  para pagamentos software-native) e controles programáveis (escrow, assinaturas, split payments, limites
  de gasto). Relevante pro ArcPulse: doc oficial da Arc já tem tutoriais nativos pra ERC-8004
  (`/arc/tutorials/register-your-first-ai-agent`) e ERC-8183 (`/arc/tutorials/create-your-first-erc-8183-job`)
  — possível ideia futura: aba "Agent Activity" monitorando registros ERC-8004 ou settlements x402, no
  mesmo padrão do Memo/Batch Activity. Ainda não implementado, só anotado.
  Fontes: community.arc.io/Arc House (blog) e arc.io/blog/building-agentic-economic-workflows-with-vyper-on-arc.

- **21/07/2026 — Arc Open Source Showcase (Canteen).** A Canteen lançou um showcase de
  projetos open source do ecossistema Arc: arc-showcase.thecanteenapp.com — codebases que
  outros builders podem fazer fork, importar e construir em cima. Call for submissions:
  projetos bem documentados que expõem primitivos reutilizáveis. Exemplo citado: Mimir
  (github.com/enliven17/mimir) — paywall para blogs em USDC.
  Conselho da comunidade: evitar DEX/swap/staking/pools (saturado, Tim B. da Circle reclamou).
  **Análise pro ArcPulse:** já se encaixa perfeitamente no perfil do Showcase — open source ✅,
  expõe primitivos reutilizáveis via API pública ✅, não é DEX/swap ✅, bem documentado ✅.
  **Ação recomendada:** submeter o ArcPulse em arc-showcase.thecanteenapp.com — aumenta
  visibilidade na comunidade e reforça o posicionamento como infraestrutura/tooling.

- **16/07/2026 — Arc Brand Guidelines & Partner Toolkit live.** A Arc publicou diretrizes
  oficiais de marca para builders e parceiros. Pontos principais:
  - **Linguagem aprovada:** "Built on Arc", "Available on Arc", "Supports Arc", "Live on Arc"
  - **Evitar:** apresentar seu app como "Arc", modificar o logo Arc, usar o logo Arc como
    identidade do seu app, linguagem que sugira endorsement além do relacionamento aprovado
  - **Regra principal:** sua marca lidera, Arc é a infraestrutura
  - Perguntas sobre uso de marca: trademarks@circle.com
  - Brand kit: arc.io/brand-guidelines-and-partner-toolkit
  Fonte: community.arc.io/home/blogs/arc-brand-guidelines-and-partner-toolkit-is-live-2026-07-16
  **Impacto direto pro ArcPulse:** revisar todos os textos do dashboard e blog post para
  garantir conformidade. O nome "ArcPulse" é seguro (marca própria). Textos como
  "Arc Testnet · Network Health Monitor" no header estão ok. Evitar qualquer framing que
  sugira que o ArcPulse é um produto oficial da Arc. No blog post/apresentação, usar
  "Built on Arc" em vez de qualquer linguagem ambígua. Checar logo usage — se o
  `Arc_Logo.png` na pasta `public` for o logo oficial da Arc, verificar se o uso atual
  está dentro das diretrizes (deve aparecer como referência, não como identidade do ArcPulse).

- **09/07/2026 — Arc x Pulsar (consumer stablecoin money app).** Pulsar está construindo um
  app consumer de movimentação de dinheiro stablecoin-native na Arc Testnet — não como feature
  isolada, mas com Arc como camada de settlement central. Fluxos: USDC e EURC em balances,
  pagamentos, atividade de cartão, FX e multi-currency. Usa CCTP e gas abstraction como
  infraestrutura de fundo. É um spotlight pré-launch (rollout em fases).
  Contexto estratégico: a maioria do ecossistema Arc é infraestrutura (liquidez, lending, wallets,
  compliance, tooling). Pulsar é o primeiro parceiro relevante do lado **consumer** — traz usuários
  finais pra atividade Arc-native, não só builders. Para a Arc, isso é diferente: é distribuição
  real para pessoas que vão segurar, mover, gastar e receber USDC/EURC sem saber que estão na Arc.
  Fonte: community.arc.io/home/blogs/arc-x-pulsar-consumer-stablecoin-money-movement-on-arc-2026-07-09
  **Impacto pro ArcPulse:** quando o Pulsar lançar e começar a gerar volume de txs, o ArcPulse
  vai capturar esse aumento no `tx_count` dos snapshots — uma forma indireta de medir a tração
  do produto. Mais relevante no longo prazo: se os endereços de contrato do Pulsar forem públicos,
  dá pra adicionar um card de "Pulsar Activity" no Network Status similar ao que fizemos com os
  contratos Chainlink. Ainda cedo, só anotado.

- **08/07/2026 — Tradable joins Arc Builders Fund.** Tradable — segunda maior plataforma de
  private credit onchain, com $2B+ em 37 deals ativos e $315M em transações no marketplace —
  está expandindo para a Arc Testnet com suporte do Arc Builders Fund. Traz contratos inteligentes
  para ciclo completo de deals (issuance, compliance AML/KYC/KYB/KYT, distribuições, cashflows).
  Relevância: confirma que a Arc está atraindo projetos institucionais sérios de RWA/private credit,
  não só DeFi de varejo. A Arc é purpose-built pra isso (USDC como gas, fees previsíveis, sub-second
  finality). **Impacto pro ArcPulse:** possível futura aba "RWA/Credit Activity" monitorando
  contratos do Tradable (deal issuance, distribuições, compliance events) — ainda muito cedo,
  endereços de contrato não foram publicados. Só anotado.
  Fonte: community.arc.io/home/blogs/ (Arc House post)

- **08/07/2026 — Incidente Supabase (JWT errors + project creation delays).** Dois incidentes
  simultâneos no Supabase em 08/07: "Elevated JWT authorization errors" (18:37 UTC) afetando
  autenticação em edge functions, e "Project creation delays in AP regions". O JWT error afeta
  diretamente o ArcPulse — `/api/collect` usa `SUPABASE_SERVICE_KEY` para autenticar inserts.
  Causa provável do gap de 76h recente (antes do cron-job.org ser configurado). Limitação do
  free tier: sem SLA de disponibilidade. Nenhuma ação necessária do nosso lado — monitorar
  status.supabase.com quando aparecerem gaps no Discord.

- **07/07/2026 — Arc Mainnet listada no The Graph.** The Graph (protocolo de indexação
  descentralizada mais usado no ecossistema Web3) publicou suporte à **Arc Mainnet** com:
  - Tipo: `mainnet` (não testnet) · Chain ID: `eip155:5042` · Identificador: `arc` · Native Currency: USDC
  - Subgraphs, Substreams e Graph Explorer já disponíveis para Arc mainnet
  Combinado com Chainlink Scale (30/06), load test (08/07) e privacy whitepaper, sinaliza
  **lançamento de mainnet iminente — possivelmente semanas**.
  **Impacto pro ArcPulse:** migração testnet → mainnet = trocar URL do RPC + chain ID.
  Toda a infraestrutura está pronta. ArcPulse pode ser o primeiro monitor de mainnet da comunidade.

- **08/07/2026 — Load test planejado na Arc Testnet.** Fase de load testing para perfilar
  performance em condições extremas. Possíveis efeitos: congestionamento, mais txs falhando,
  fees maiores, block times mais altos, pausas momentâneas. Status page: status.arc.io.
  ArcPulse capturou baseline antes do teste: block #50333574, health score 100 (07/07).
  Alertas por severidade (🟡/🔴/🚨/✅ implementados em 05/07) serão testados em condição real.

- **30/06/2026 — Arc x Chainlink Scale (GRANDE UPDATE).** Arc entrou no programa Chainlink Scale —
  infraestrutura enterprise de oráculos e interoperabilidade cross-chain agora disponível na Arc Testnet.
  O que está live no testnet:
  - **CCIP Router:** `0xdE4E7FED43FAC37EB21aA0643d9852f75332eab8`
  - **Chain Selector Arc Testnet:** `3034092155422581607`
  - **ARM Proxy:** `0xD610B8f58689de7755947C05342A2DFaC30ebD57`
  - **Token Admin Registry:** `0xd3e461C55676B10634a5F81b747c324B85686Dd1`
  - **Registry Module Owner Custom:** `0x524B83ae8208490151339c626fd0E35b964483e3`
  - **CCIP Config:** `0x3F1f176e347235858DD6Db905DDBA09Eaf25478a`
  Serviços disponíveis: Chainlink Data Streams e Data Feeds (market data de baixa latência),
  CCIP (interoperabilidade cross-chain segura), Proof of Reserve (verificação de colateral em
  near-real time). Casos de uso: finance apps com market data externo, treasury/collateral
  cross-chain, ativos tokenizados, coordenação de contratos entre chains.
  Docs: docs.arc.network/arc/tools/oracles | docs.chain.link/builders-quick-links
  Fonte: community.arc.io/home/blogs/arc-x-chainlink-data-and-cross-chain-infrastructure-for-arc-builders-2026-06-30
  **Impacto pro ArcPulse:** possível futura aba "Oracle & CCIP Monitor" — monitorar atividade
  no CCIP Router (mensagens cross-chain enviadas/recebidas), Data Feed updates (latência entre
  updates de preço), e status do ARM Proxy. Seria uma feature exclusiva que nenhum outro
  dashboard da Arc teria. Alta prioridade pra próxima sessão de desenvolvimento.

## 🏁 Roadmap original — 100% concluído

Todos os itens planejados foram implementados e validados em produção.

## 💡 Próximas ideias (a priorizar)

1. **Apresentação para Arc House / Office Hours** — blog post e roteiro de live já prontos
   (gerados em 01/07). Publicar em community.arc.io e apresentar no Arc Hours no Discord.

2. **Data Feeds Monitor** — complemento natural ao Chainlink Monitor: quando endereços de
   Data Feed forem publicados pra Arc Testnet, monitorar `latestRoundData()` de cada feed
   (BTC/USD, ETH/USD, etc.) mostrando preço atual, última atualização, e frequência de heartbeat.

3. **Agent Activity Monitor** — monitorar registros ERC-8004 (agentes de IA) e settlements x402
   na Arc Testnet, no mesmo padrão do Memo/Batch Activity. Inspirado no spotlight da Vyper (26/06).

4. **Melhorar varredura do Memo Activity** — trocar varredura bloco-a-bloco por `eth_getLogs`
   (muito mais eficiente). Doc oficial confirma que o contrato Memo emite eventos com índice sequencial.

## Contexto do projeto (para retomar em chat novo)

- Site: https://arcpulse-self.vercel.app
- GitHub: https://github.com/filipelclima/ArcPulse
- Supabase: `xquxgqypeappuxdmusdt` (snapshots) — projeto Vercel correto é **`arcpulse`** (sem hífen).
  Existia um projeto duplicado **`arc-pulse`** (com hífen) que escrevia num Supabase órfão diferente —
  **já deletado da Vercel (28/06)**. Banco Supabase órfão associado a ele pode ainda existir, pendente
  de limpeza (ver pendências abertas).
- Pasta local: `C:\Users\faecu\Downloads\arcpulse\arcpulse`
- Stack: Next.js 14 + Vercel + Supabase + Anthropic API + RPC público `https://rpc.testnet.arc.network`
- `/api/collect`: coleta snapshots no Supabase (cron 1x/dia + manual + self-heal no frontend) + alerta
  Discord via `DISCORD_WEBHOOK_URL`
- `/api/report`: gera relatório via Anthropic API
- `DevDashboard.tsx`: ConnectButton/DevDashboardTab própria, sem Reown/WalletConnect (`window.ethereum` direto)
- Script de teste de memos: `send-memo.ts` em `C:\Users\faecu\Downloads\memo-test\memo-test` (fora do projeto principal)
- Fluxo de deploy: Claude gera arquivo → zip → usuário extrai com `tar -xf` no CMD → `git add/commit/push` → Vercel auto-deploy
- v0.7.2 hardfork (18/06/2026): Transaction Memos + Batch Transactions (ativos). Privacy whitepaper:
  anunciado, ainda não implementado na chain.
- HashZero já submeteu formulário de Office Hours da Arc.
