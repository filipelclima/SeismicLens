# SeismicLens

Dashboard de monitoramento da Seismic blockchain testnet — a privacy-enabled EVM L1 (nodes rodando dentro de TEEs Intel TDX, shielded storage, transações encriptadas tipo `0x4A`). Modelado a partir do [ArcPulse](https://github.com/filipelclima/ArcPulse) (monitor equivalente para a Arc testnet).

- **GitHub:** https://github.com/filipelclima/SeismicLens
- **Deploy:** publicado na Vercel (Framework Preset: Next.js, ver `vercel.json`) — preencher a URL de produção aqui quando confirmada. Ver `.env.example` para as env vars necessárias.
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
  - `/api/collect` — roda via cron diário (`vercel.json`), faz scrape da RPC, calcula health score, insere snapshot no Supabase, envia alertas no Discord em transições de anomalia
  - `/api/report` — gera relatório semanal via Anthropic API a partir dos snapshots de um dia
  - `/api/public-stats` — API pública somente-leitura (CORS aberto) sobre os snapshots coletados

## Particularidades da Seismic (vs. Arc/EVM padrão)

- **Transação shielded = tipo `0x4A`.** Calldata é encriptada client-side (ECDH + AEAD) e só é decriptada dentro da TEE do node. Detecção é sempre por `tx.type`, nunca por endereço de contrato — diferente do "Memo Activity" do ArcPulse, que rastreava um único contrato conhecido. Ver `SHIELDED_TX_TYPE` em `src/lib/chain.ts` e a aba Shielded Activity.
- **Gas é pago em ETH** (18 decimais), não em USDC como na Arc — todo cálculo de saldo/custo usa `/1e18`, não `/1e6`.
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

## Setup do Supabase

Rodar `supabase/schema.sql` uma vez no SQL editor de um projeto Supabase novo antes do primeiro deploy — cria a tabela `network_snapshots` com RLS (leitura pública, escrita só via service key).

## Comandos

```bash
npm run dev      # dev server
npm run build    # build de produção
npm test         # roda a suíte de testes (vitest run)
npx tsc --noEmit # typecheck isolado
```
