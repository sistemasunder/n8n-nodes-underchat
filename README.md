# n8n-nodes-underchat

Community Node do n8n para integrar workflows à API pública da UnderChat.

## Operações

- Verificar dias e faixas de horário, com saídas Dentro do horário e Fora do horário
- Entrar em um atendimento aguardando com o executor selecionado
- Buscar ID do contato pelo telefone
- Criar contato
- Enviar mensagem de texto por `chat_id`
- Enviar mensagem por telefone, criando o contato quando necessário
- Enviar template oficial em uma conversa
- Listar executores, usuários e setores
- Transferir um chat para outro usuário, setor ou worker

Os campos de executor, usuário, setor e worker oferecem busca na API e também
permitem informar o UUID manualmente.

Antes de **Enviar mensagem por Chat ID**, o node consulta uma vez os atendentes do
chat. Se o atendente principal ainda não tiver ingressado, o executor selecionado
assume o atendimento automaticamente; se o atendimento já estiver em andamento,
a mensagem é enviada diretamente.

A operação **Enviar mensagem por telefone** executa automaticamente:

```text
buscar contato → criar se necessário → iniciar conversa → enviar mensagem
```

Na operação **Transferir para setor ou usuário**, ative **Entrar no atendimento
antes de transferir** quando o chat ainda estiver aguardando atendimento. O node
muda o status para `in_chat` e, após a confirmação da API, realiza a transferência.

A API pública permite controlar a mensagem automática da transferência, mas não
expõe uma opção equivalente para a mensagem de ingresso no atendimento.

## Horário de funcionamento

O recurso **Horário de funcionamento → Verificar horário** permite configurar uma
agenda semanal diretamente no node, sem código, API Key ou usuário executor.
A agenda é configurada no n8n: não consulta nem altera os horários cadastrados no
painel da UnderChat. Use o node **UnderChat** normal, não a versão **UnderChat Tool**.

1. Selecione o recurso **Horário de funcionamento**.
2. Escolha o **Fuso horário**: Brasília, o fuso do workflow, UTC ou um nome IANA
   personalizado, como `America/Manaus`.
3. Em **Faixas de horário**, clique em **Adicionar faixa de horário**.
4. Selecione um ou mais **Dias da semana** e preencha **Início** e **Fim** no
   formato `HH:mm`. Para liberar o dia todo, ative **Dia inteiro**.
5. Adicione outras faixas para intervalos de almoço, horários diferentes na sexta
   ou regras específicas para o fim de semana.
6. Conecte as saídas:

   - **Dentro do horário:** segue quando qualquer faixa corresponder ao momento atual.
   - **Fora do horário:** segue quando nenhuma faixa corresponder.

As duas saídas preservam os dados de entrada, arquivos binários e o vínculo de cada
item com os nodes anteriores. O recurso não envia mensagens por conta própria.
Deixar uma saída sem conexão encerra aquele caminho.

### Exemplo: agenda Redireciona

Para reproduzir a agenda de redirecionamento apresentada no painel, selecione
**Brasília (America/Sao_Paulo)** e cadastre estas cinco faixas:

| Dias selecionados | Início | Fim | Dia inteiro |
| --- | --- | --- | --- |
| Segunda a sexta | 00:00 | 07:59 | Não |
| Segunda a sexta | 12:01 | 12:59 | Não |
| Segunda a quinta | 18:00 | 23:59 | Não |
| Sexta | 17:00 | 23:59 | Não |
| Sábado e domingo | — | — | Sim |

No fluxo de mensagens, coloque esse node na saída de **mensagens recebidas**, após
a separação de mensagens enviadas/recebidas. Ligue **Dentro do horário** à automação
e deixe **Fora do horário** sem conexão. Isso mantém o caminho que bloqueia a IA
quando um atendente humano responde, independentemente do horário.

### Regras e cuidados

- O minuto final é inclusivo: `07:59` inclui até `07:59:59.999`; `08:00` já fica fora.
- O intervalo `12:01–12:59` não inclui o minuto `12:00`.
- Uma faixa `22:00–02:00` começa no dia selecionado e termina às `02:00:59.999` do
  dia seguinte. Isso também funciona de domingo para segunda.
- Início e fim iguais liberam apenas esse minuto. Use **Dia inteiro** para 24 horas.
- Dias sem faixas são considerados fora do horário; faixas sobrepostas não duplicam itens.
- A data/hora atual é capturada uma vez por execução do node, no fuso escolhido.
  O recurso não é um agendador e não usa o horário original de uma mensagem antiga.
- Feriados seguem a regra semanal; não há calendário de feriados nesta versão.
- É obrigatório cadastrar ao menos uma faixa válida. Dias, horários ou fusos
  inválidos causam erro, sem encaminhar o item como se a configuração fosse válida.
- Para usar o recurso como condição, mantenha **Always Output Data** desativado e
  **On Error → Stop Workflow**. Alterar essas opções genéricas do n8n pode fazer o
  fluxo continuar mesmo sem correspondência ou quando ocorrer um erro.

## Requisitos

- Node.js 22 ou superior
- n8n com suporte a Community Nodes
- Conta UnderChat com plano ativo
- Token da API pública
- Um usuário executor ativo nas operações que exigem contexto de usuário

Conta, API Key e executor são necessários apenas para as operações que acessam
a API da UnderChat. O recurso **Horário de funcionamento** é local.

## Desenvolvimento

```bash
npm install
npm run build
npm run lint
npm test
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
