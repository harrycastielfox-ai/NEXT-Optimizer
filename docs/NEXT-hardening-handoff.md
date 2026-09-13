# NEXT: revisão de segurança e preparação de release

Atualizado em 13/09/2026. Este trabalho não autoriza publicar o app como pronto para uso real.

## Mudanças

- Nome comercial NEXT; identificadores internos Hermes/NEX preservados para não perder dados, configurações e compatibilidade de atualização.
- Falhas, indisponibilidade e verificações inconclusivas ficam visíveis e não liberam a fase seguinte. Simulação não exige reiniciar Windows. Reinício real exige clique e confirmação.
- Credencial de licença opaca (256 bits), armazenada com DPAPI por usuário no Windows e mantida fora do JavaScript. Operações reais verificam autorização no Rust; um estado adulterado no localStorage não libera os motores. Cache nativo limitado a 30 segundos; falha de renovação bloqueia novas alterações. A recuperação permanece acessível sem assinatura ativa.
- Servidor usa somente hashes dos tokens, vínculo de dispositivo, revogação, rate limit persistente e auditoria sem payloads/segredos. RPCs antigos de autorização somente por e-mail são desabilitados.
- Interface não anuncia atualizador automático inexistente. Conta orienta transferência manual com suporte; Google OAuth não é apresentado como disponível.
- O runner de QA automático não aprova mais testes visuais/funcionais por `QuickPassAll`: inicializa itens pendentes e preserva evidências existentes. Aprovação rápida manual exige confirmação humana e é bloqueada em CI/modo automático seguro. Pacotes antigos precisam ser regenerados antes de uso.
- CI em runners padrão de repositório público, sem cache/artifacts automáticos: lint, TypeScript, testes puros, build, Rust auditado e instaladores em modo teste. PostgreSQL sintético valida migrações sem conexão com o banco real.
- Dependências indiretas corrigidas com npm 10, sem atualizações major forçadas; Vite 7.3.6 aceita esbuild corrigido 0.28.2. `npm audit --package-lock-only` passou sem alertas na revisão. Instalação suportada: `npm ci --ignore-scripts`; `package-lock.json` é a referência. O `bun.lock` antigo foi removido para não instalar novamente versões vulneráveis divergentes; recuperável no Git. Supabase JS está fixado em 2.110.6.

## Implantação do licenciamento: publicada no projeto novo

Com autorização do proprietário, o projeto **NEXT OTIMIZAÇÃO** (`dtzyeinqcdjnzefgphcd`, São Paulo) substitui o host antigo no código do app. O projeto estava vazio: foram aplicadas as nove migrações existentes e uma migração adicional de fechamento das APIs OAuth legadas/índices. As duas Edge Functions estão ativas. O projeto antigo não foi alterado e não houve importação de contas ou compras.

SQL transacional com rollback e 22 requisições HTTP sintéticas passaram no serviço publicado. A chave temporária, conta, código e sessões do smoke test foram removidos; auditoria preservada. Nenhuma chave administrativa permanente foi criada. Ver [registro da implantação e mapeamento das migrações](NEXT-supabase-deployment-2026-09-13.md).

O novo app exige **a migração e ambas as Edge Functions novas juntas**. O protocolo anterior não é compatível. Antes de distribuir:

1. Para futuras atualizações, confirmar o projeto `dtzyeinqcdjnzefgphcd` e o host fixo em `src-tauri/src/license_transport.rs`.
2. Fazer backup e validar o histórico remoto de migrações, esquema e privilégios antes de novas mudanças com dados reais. O MCP atribuiu versões remotas próprias: não executar `db push` cegamente com os timestamps locais; consultar o mapeamento no registro. Testes CI usam um PostgreSQL vazio com fixtures de Auth, não validam drift ou dados de produção.
   O histórico de julho continha um parâmetro de saída `requested_email` com o mesmo nome da entrada em `get_email_device_entitlement`; foi corrigido para `account_email` para permitir bootstrap. Esse ajuste de arquivo histórico **não altera bancos já existentes**: comparar a definição remota antes de migrar, sem reaplicar o histórico à força. A API antiga fica revogada pelo novo protocolo.
3. Em futuras alterações, planejar atualização coordenada de banco, `nex-license-session`, `nex-license-admin` e cliente nativo. As funções foram publicadas com seus lockfiles. `verify_jwt = false` é intencional: ativação exige código de compra, verificação exige token opaco e administração exige chave secreta própria validada pelo backend.
4. Manter `SUPABASE_SERVICE_ROLE_KEY` apenas nos segredos do servidor. Não colocar em variáveis VITE, arquivos versionados, conversas ou logs. Chaves administrativas são guardadas por hash no banco.
5. Validar em ambiente autorizado: ativação válida/inválida, mesmo dispositivo, outro dispositivo, expiração, rede offline, logout, revogação e transferência. Usuários existentes precisam do código original para recriar a sessão. Reativar o mesmo código no mesmo PC não renova a duração.
6. Transferência exige operador autenticado e prova do código já resgatado, com conferência externa do pedido pelo suporte. Limite: três transferências por 30 dias; sessões anteriores são revogadas. A API usa `accountId` do modelo por e-mail; o painel legado de transferências OAuth não representa esse fluxo novo.

Em falha de implantação, suspender distribuição e corrigir o novo protocolo. Não reabrir RPCs antigos sem análise de segurança. Backup e rollback de banco precisam preservar compras e revogações ocorridas na janela.

## Pendências que não podem ser declaradas testadas

- Instalação, upgrade/desinstalação, DPAPI/HTTPS ao vivo, otimizações, reinício e restauração em Windows de teste autorizado. Não executados na máquina pessoal.
- Authenticode com certificado válido: envolve decisão/custo do proprietário; não adquirido ou importado.
- Cadastro do operador administrativo definitivo, com e-mail confirmado pelo proprietário e entrega segura da chave fora de Git/logs/conversa; não usar as credenciais sintéticas do teste.
- QA visual e comportamento completo com diferentes resoluções, idiomas e hardware.

Scripts de verificação de fonte não substituem testes funcionais. Os testes Rust do CI são uma lista explícita de testes sem efeitos no sistema; não executar `cargo test` sem filtro porque há testes legados que movem arquivos e chamam PowerShell. Nenhuma evidência de QA manual deve ser preenchida automaticamente como aprovação.
