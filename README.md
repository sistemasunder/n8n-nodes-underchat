# n8n-nodes-underchat

Community Node do n8n para integrar workflows à API pública da UnderChat.

## Operações

- Buscar ID do contato pelo telefone
- Criar contato
- Enviar mensagem de texto por `chat_id`
- Enviar mensagem por telefone, criando o contato quando necessário
- Enviar template oficial em uma conversa
- Listar executores, usuários e setores
- Transferir um chat para outro usuário, setor ou worker

Os campos de executor, usuário, setor e worker oferecem busca na API e também
permitem informar o UUID manualmente.

A operação **Enviar mensagem por telefone** executa automaticamente:

```text
buscar contato → criar se necessário → iniciar conversa → enviar mensagem
```

## Requisitos

- Node.js 22 ou superior
- n8n com suporte a Community Nodes
- Conta UnderChat com plano ativo
- Token da API pública
- Um usuário executor ativo nas operações que exigem contexto de usuário

## Desenvolvimento

```bash
npm install
npm run build
npm run lint
npm run dev
```

O modo de desenvolvimento inicia uma instância do n8n com o node carregado.

## Credenciais

No n8n, crie uma credencial **UnderChat API** e informe:

- **API Key:** token gerado em `Integração → API pública`.
- **URL Base:** mantenha `https://api-public.underchat.com.br/v1` em produção.

A API key identifica a conta e é enviada no header `keyapi`. Não existe um
executor padrão: em cada node, selecione explicitamente o usuário executor que
deve realizar a operação. O node consulta os executores ativos da conta e envia
o selecionado no header `x-underchat-user-id`.

## Teste seguro

O envio de mensagens produz efeito real no canal configurado. Use um contato e um
canal controlados durante a validação.

## Documentação

- [UnderChat Developers](https://docs.underchat.com.br/)
- [Criação de nodes do n8n](https://docs.n8n.io/integrations/creating-nodes/)

## Licença

MIT
