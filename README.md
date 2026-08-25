# n8n-nodes-underchat

Community Node do n8n para integrar workflows à API pública da UnderChat.

## Operações do MVP

- Buscar contato por telefone
- Criar contato
- Enviar mensagem de texto por `chat_id`
- Enviar mensagem por telefone, criando o contato quando necessário
- Enviar template oficial em uma conversa

A operação **Enviar mensagem por telefone** executa automaticamente:

```text
buscar contato → criar se necessário → iniciar conversa → enviar mensagem
```

## Requisitos

- Node.js 22 ou superior
- n8n com suporte a Community Nodes
- Conta UnderChat com plano ativo
- Token da API pública
- UUID de um usuário executor ativo

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
- **ID do Usuário Executor:** UUID do usuário cujas permissões serão aplicadas.
- **URL Base:** mantenha `https://api-public.underchat.com.br/v1` em produção.

A integração envia a chave no header `keyapi` e o executor em
`x-underchat-user-id`.

## Teste seguro

O envio de mensagens produz efeito real no canal configurado. Use um contato e um
canal controlados durante a validação.

## Documentação

- [UnderChat Developers](https://docs.underchat.com.br/)
- [Criação de nodes do n8n](https://docs.n8n.io/integrations/creating-nodes/)

## Licença

MIT
