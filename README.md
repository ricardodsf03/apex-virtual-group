# Apex Virtual Group — Starter

Primeiro protótipo responsivo da interface da Apex Virtual Group, pensado para iPadOS e computadores.

## O que já existe
- Dashboard responsivo com alternância entre Centro de Comando e Escritório (vista conceptual).
- Cartões dos nove diretores iniciais.
- Lista de projetos e tarefas demonstrativas.
- Estados claramente identificados como dados de demonstração.
- Manifesto PWA e service worker básico.

## O que ainda NÃO está ligado
Este starter é apenas a primeira camada visual. Ainda não existem agentes de IA reais, autenticação, base de dados, memória persistente, execução em segundo plano ou integração com APIs. Não introduza chaves secretas no frontend.

## Executar num ambiente cloud pelo iPad
1. Crie uma conta GitHub, se ainda não tiver.
2. Crie um repositório privado chamado `apex-virtual-group`.
3. Carregue o conteúdo desta pasta para o repositório (pode carregar os ficheiros pelo site GitHub no Safari).
4. No GitHub, abra o repositório e escolha **Code → Codespaces → Create codespace on main** (se disponível na sua conta).
5. No terminal do Codespaces, execute:
   ```bash
   python3 -m http.server 8000 --directory .
   ```
6. Abra a porta 8000 no separador **Ports** do Codespaces e escolha abrir no browser.

Também pode publicar esta primeira interface estática num serviço de hosting compatível com sites estáticos. Para produção, configurar domínio, HTTPS e políticas de segurança.

## Próximas etapas técnicas
1. Criar backend FastAPI e autenticação.
2. Criar projeto Supabase e tabelas com políticas RLS.
3. Implementar o CEO-orquestrador e os agentes especializados.
4. Implementar filas duráveis para tarefas longas.
5. Integrar fornecedores de modelos de IA através do backend.
6. Ligar dashboard a dados reais.
7. Construir a experiência 3D com React Three Fiber numa fase posterior.

## Segurança
- Nunca guardar tokens/API keys em `app.js`, HTML ou outros ficheiros públicos.
- Usar variáveis de ambiente no backend/hosting.
- Ativar MFA nas contas cloud.
- Começar com repositório privado.
- Não permitir pagamentos, contratos, mensagens externas ou alterações destrutivas sem aprovação humana.
