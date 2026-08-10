# ArcPulse

Dashboard de monitoramento da Arc blockchain testnet. Builder: HashZero. Objetivo: reputação na comunidade Arc House / cargo de Builder-Architect.

- **Deploy:** https://arcpulse-self.vercel.app — **em produção, uso real.** Qualquer mudança de código deve ser testada localmente antes de deploy; nunca empurrar mudança não verificada direto pra produção.
- **GitHub:** https://github.com/filipelclima/ArcPulse
- **Histórico completo / decisões passadas:** `ROADMAP.md` neste repo — sempre consultar antes de mexer em áreas já existentes (várias armadilhas já documentadas lá, ex. cron do Vercel Hobby sem retry, Supabase free tier pausando por inatividade, projeto Vercel duplicado já deletado).

## Stack

- Next.js `14.2.3`
- ethers `^6.16.0` + viem `^2.21.19`
- @supabase/supabase-js `^2.107.0` (coleta de snapshots)
- recharts `^2.12.7` (gráficos)
- Tailwind CSS

## Estrutura

- `src/app/page.tsx` — dashboard principal (abas: Reports, Compare, Anomalies, Network Status, Networks, Memo Activity, Batch Transactions, Chainlink Monitor)
- `src/app/DevDashboard.tsx` — aba Dev Dashboard (Connect Wallet via MetaMask/Rabby)
- `src/app/useArcData.ts` — hook de coleta/leitura de dados da chain
- API routes (`/api/collect`, `/api/public-stats`, `/api/faucet-status`) — ver `ROADMAP.md` para detalhes de cada uma

## Regras de trabalho

1. **Sempre rodar os testes unitários existentes antes de fazer commit.**
2. **Sempre escrever testes novos para features novas ou correções de bugs.**
3. **Sempre atualizar este CLAUDE.md após mudanças significativas** (e continuar registrando o histórico detalhado no `ROADMAP.md`, como já é feito neste projeto).
4. **Manter dependências fixadas em versões exatas** (sem `^` ou `~`) ao adicionar ou atualizar pacotes.
5. **Nunca usar atalhos que escondem erros** (`ignoreBuildErrors`, `@ts-nocheck`, etc.) — sempre corrigir a causa raiz.

## Testes

- Vitest `4.1.10` + Testing Library, ambiente `jsdom`. Config em `vitest.config.mts` / `vitest.setup.mts` (extensão `.mts` de propósito: o `tsconfig.json` deste projeto usa `include: ["**/*.ts", "**/*.tsx"]` sem exclusão de testes, e um `.ts`/`.tsx` normal entraria no type-check do `next build`; `.mts` não bate nesse glob, então a config de teste fica isolada do build de produção).
- **Ainda não há teste de exemplo escrito.** As funções puras candidatas mais óbvias (`toCSV`, `exportCSV`, `exportJSON`, `downloadFile` em `src/app/page.tsx`) não são exportadas do módulo — escrever um teste pra elas exigiria adicionar `export`, e essa sessão foi instruída a não tocar em nenhum código existente (produção real, sem tocar no que já funciona). Ao adicionar a próxima feature ou correção, exportar as funções puras relevantes e escrever o primeiro teste real ali.
- `npm test` já roda limpo com zero arquivos de teste (`passWithNoTests: true`) — não é erro, é só o estado inicial.

## Comandos

```bash
npm run dev      # dev server
npm run build    # build de produção
npm test         # roda a suíte de testes (vitest run)
```
