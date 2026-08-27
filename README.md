# n8n-nodes-underchat

Community Node do n8n para integrar workflows à API pública da UnderChat.

## Operações

- Verificar dias e faixas de horário, com saídas Dentro do horário e Fora do horário
- Entrar em um atendimento aguardando com o executor selecionado
- Buscar ID do contato pelo telefone
- Criar contato
- Buscar/criar o contato e iniciar um atendimento em uma única operação
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

## Buscar/criar contato e iniciar atendimento

A operação **Buscar/Criar Contato E Iniciar Atendimento** (`startChatByPhone`)
substitui a sequência manual de nodes usada para localizar ou cadastrar o contato,
obter seu ID e abrir a conversa. Ela recebe o telefone diretamente e executa:

```text
buscar pelo telefone → criar se não existir → buscar o ID novamente
→ validar canal e setor → reutilizar um chat ativo ou iniciar o atendimento
```

Configure os seguintes campos:

- **Executor:** usuário ativo que realiza as chamadas à API.
- **DDI** e **Telefone:** usados na busca exata; informe o telefone sem o DDI.
- **Nome para novo contato:** usado somente quando o contato não existe.
- **Criar se não existir:** ativado por padrão. Quando desativado, a operação falha
  sem criar dados caso o telefone não seja encontrado.
- **Canal:** obrigatório em toda nova abertura, oficial ou não.
- **Setor:** obrigatório em toda nova abertura, oficial ou não.
- **Template oficial** e **Variáveis:** usados quando as regras do canal oficial
  exigirem um template aprovado.

O usuário não precisa consultar nem transportar o `contact_id`. A API de criação
de contato não devolve esse ID; por isso o node consulta novamente o telefone após
uma criação bem-sucedida e só então inicia o atendimento. Se já existir um chat
ativo no mesmo canal e setor, ele é reutilizado em vez de criar outro. Um chat no
mesmo canal, mas em outro setor, não é movido silenciosamente: use a operação de
transferência ou selecione o setor atual.

O cadastro do contato e a abertura do atendimento são chamadas separadas da API.
Se a criação funcionar e uma validação posterior ou a abertura falhar, o contato
permanece cadastrado. Uma nova execução o localizará e reutilizará, sem duplicá-lo.

### Canal oficial e templates

Depois de resolver o contato, o node consulta o contexto oficial usando o canal e
o `contact_id`. Ele respeita a janela retornada pela UnderChat:

- texto livre só pode ser enviado quando `can_send_freeform` permitir;
- um template só pode ser usado quando estiver aprovado e disponível no contexto;
- quando `requires_template` estiver ativo, a abertura não continua sem um template
  aprovado e todos os valores obrigatórios;
- `key`, componente, posição, nome do parâmetro e índice de botão vêm da API; o
  usuário informa apenas os valores das variáveis, pelos campos ou em JSON;
- o template é enviado junto da abertura do chat, evitando depender de um
  `chat_id` criado em um node anterior.

O campo **Template oficial** usa o seletor do n8n e também permite informar o nome
manualmente. A API pública lista os templates no contexto oficial, que exige um
`contact_id`. Quando o telefone é dinâmico ou o contato ainda não existe, o node
usa um contato já vinculado ao canal somente para carregar o catálogo no editor,
sem criar nem alterar dados. Na execução, ele consulta novamente o contexto com o
contato real e recusa qualquer template que não esteja aprovado ou cujas variáveis
não correspondam ao contrato retornado. Se o canal ainda não tiver nenhum contato,
o catálogo não poderá ser carregado antecipadamente; nesse caso ainda é possível
usar o modo manual/JSON, com a mesma validação rigorosa durante a execução.

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
