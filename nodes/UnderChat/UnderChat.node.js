"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnderChat = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const GenericFunctions_1 = require("./GenericFunctions");
const showFor = (operations) => ({ show: { operation: operations } });
class UnderChat {
    constructor() {
        this.description = {
            displayName: 'UnderChat',
            name: 'underChat',
            icon: { light: 'file:underchat.svg', dark: 'file:underchat.dark.svg' },
            group: ['transform'],
            version: 1,
            description: 'Gerencie contatos e envie mensagens pela UnderChat',
            subtitle: '={{$parameter["operation"]}}',
            defaults: { name: 'UnderChat' },
            inputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            usableAsTool: true,
            credentials: [{ name: 'underChatApi', required: true }],
            properties: [
                {
                    displayName: 'Operação',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        { name: 'Buscar Contato Por Telefone', value: 'findContactByPhone', action: 'Buscar contato por telefone' },
                        { name: 'Criar Contato', value: 'createContact', action: 'Criar contato' },
                        { name: 'Enviar Mensagem Por Chat ID', value: 'sendText', action: 'Enviar mensagem por chat ID' },
                        { name: 'Enviar Mensagem Por Telefone', value: 'sendTextByPhone', action: 'Enviar mensagem por telefone' },
                        { name: 'Enviar Template Oficial', value: 'sendOfficialTemplate', action: 'Enviar template oficial' },
                    ],
                    default: 'sendTextByPhone',
                },
                {
                    displayName: 'Telefone',
                    name: 'phone',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Telefone com DDI, contendo somente números',
                    displayOptions: showFor(['findContactByPhone', 'createContact', 'sendTextByPhone']),
                },
                {
                    displayName: 'Nome',
                    name: 'contactName',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: showFor(['createContact']),
                },
                {
                    displayName: 'Nome Para Novo Contato',
                    name: 'contactName',
                    type: 'string',
                    default: '',
                    description: 'Usado somente se o contato ainda não existir',
                    displayOptions: showFor(['sendTextByPhone']),
                },
                {
                    displayName: 'Worker ID',
                    name: 'workerId',
                    type: 'string',
                    default: '',
                    description: 'UUID do canal/worker usado para localizar ou iniciar o atendimento',
                    displayOptions: showFor(['findContactByPhone', 'createContact', 'sendTextByPhone']),
                },
                {
                    displayName: 'Criar Se Não Existir',
                    name: 'createIfMissing',
                    type: 'boolean',
                    default: true,
                    displayOptions: showFor(['sendTextByPhone']),
                },
                {
                    displayName: 'Sector ID',
                    name: 'sectorId',
                    type: 'string',
                    default: '',
                    description: 'Setor inicial opcional para uma nova conversa',
                    displayOptions: showFor(['sendTextByPhone']),
                },
                {
                    displayName: 'Chat ID',
                    name: 'chatId',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: showFor(['sendText', 'sendOfficialTemplate']),
                },
                {
                    displayName: 'Mensagem',
                    name: 'message',
                    type: 'string',
                    typeOptions: { rows: 4 },
                    default: '',
                    required: true,
                    displayOptions: showFor(['sendText', 'sendTextByPhone']),
                },
                {
                    displayName: 'Nome Do Template',
                    name: 'templateName',
                    type: 'string',
                    default: '',
                    required: true,
                    displayOptions: showFor(['sendOfficialTemplate']),
                },
                {
                    displayName: 'Idioma',
                    name: 'templateLanguage',
                    type: 'string',
                    default: 'pt_BR',
                    required: true,
                    displayOptions: showFor(['sendOfficialTemplate']),
                },
                {
                    displayName: 'Variáveis (JSON)',
                    name: 'templateVariables',
                    type: 'json',
                    default: '[]',
                    description: 'Lista com key, component_type, index, value e button_index quando aplicável',
                    displayOptions: showFor(['sendOfficialTemplate']),
                },
                {
                    displayName: 'Campos Adicionais (JSON)',
                    name: 'additionalFields',
                    type: 'json',
                    default: '{}',
                    description: 'Campos opcionais aceitos pela API para criação do contato',
                    displayOptions: showFor(['createContact', 'sendTextByPhone']),
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const output = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const operation = this.getNodeParameter('operation', itemIndex);
                let result;
                if (operation === 'findContactByPhone') {
                    const phone = this.getNodeParameter('phone', itemIndex);
                    const workerId = this.getNodeParameter('workerId', itemIndex, '');
                    const response = await GenericFunctions_1.underChatApiRequest.call(this, 'GET', '/chat/contacts/by-phone', {}, (0, GenericFunctions_1.withoutEmptyValues)({ phone, worker_id: workerId }));
                    result = (0, GenericFunctions_1.responseData)(response);
                }
                else if (operation === 'createContact') {
                    const phone = this.getNodeParameter('phone', itemIndex);
                    const name = this.getNodeParameter('contactName', itemIndex);
                    const workerId = this.getNodeParameter('workerId', itemIndex, '');
                    const extra = (0, GenericFunctions_1.parseJsonObject)(this.getNodeParameter('additionalFields', itemIndex, '{}'));
                    const response = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', '/chat/contacts', (0, GenericFunctions_1.withoutEmptyValues)({ name, phone, worker_id: workerId, ...extra }));
                    result = (0, GenericFunctions_1.responseData)(response);
                }
                else if (operation === 'sendText') {
                    const chatId = this.getNodeParameter('chatId', itemIndex);
                    const message = this.getNodeParameter('message', itemIndex);
                    const response = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', `/chat/${chatId}`, {
                        type: 'text',
                        message,
                    });
                    result = (0, GenericFunctions_1.responseData)(response);
                }
                else if (operation === 'sendOfficialTemplate') {
                    const chatId = this.getNodeParameter('chatId', itemIndex);
                    const name = this.getNodeParameter('templateName', itemIndex);
                    const language = this.getNodeParameter('templateLanguage', itemIndex);
                    const variables = (0, GenericFunctions_1.parseJsonArray)(this.getNodeParameter('templateVariables', itemIndex, '[]'));
                    const response = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', `/chat/${chatId}/official-template`, { name, language, variables });
                    result = (0, GenericFunctions_1.responseData)(response);
                }
                else if (operation === 'sendTextByPhone') {
                    const phone = this.getNodeParameter('phone', itemIndex);
                    const name = this.getNodeParameter('contactName', itemIndex, '');
                    const message = this.getNodeParameter('message', itemIndex);
                    const workerId = this.getNodeParameter('workerId', itemIndex);
                    const sectorId = this.getNodeParameter('sectorId', itemIndex, '');
                    const createIfMissing = this.getNodeParameter('createIfMissing', itemIndex);
                    const extra = (0, GenericFunctions_1.parseJsonObject)(this.getNodeParameter('additionalFields', itemIndex, '{}'));
                    const foundResponse = await GenericFunctions_1.underChatApiRequest.call(this, 'GET', '/chat/contacts/by-phone', {}, (0, GenericFunctions_1.withoutEmptyValues)({ phone, worker_id: workerId }));
                    let contact = (0, GenericFunctions_1.firstRecord)(foundResponse);
                    let created = false;
                    if (!(0, GenericFunctions_1.getOpaqueId)(contact, ['contact_id', 'id'])) {
                        if (!createIfMissing)
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Contato não encontrado', { itemIndex });
                        if (!name)
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Informe o nome para criar o contato', { itemIndex });
                        const createdResponse = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', '/chat/contacts', (0, GenericFunctions_1.withoutEmptyValues)({ name, phone, worker_id: workerId, ...extra }));
                        contact = (0, GenericFunctions_1.firstRecord)(createdResponse);
                        created = true;
                    }
                    const contactId = (0, GenericFunctions_1.getOpaqueId)(contact, ['contact_id', 'id']);
                    if (!contactId)
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'A API não retornou o ID do contato', { itemIndex });
                    if (!workerId)
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Informe o Worker ID para iniciar a conversa', { itemIndex });
                    const startedResponse = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', '/chat/start-with-contact', (0, GenericFunctions_1.withoutEmptyValues)({ contact_id: contactId, worker_id: workerId, sector_id: sectorId }));
                    const chat = (0, GenericFunctions_1.firstRecord)(startedResponse);
                    const chatId = (0, GenericFunctions_1.getOpaqueId)(chat, ['chat_id', 'id']);
                    if (!chatId)
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'A API não retornou o ID do chat', { itemIndex });
                    const messageResponse = await GenericFunctions_1.underChatApiRequest.call(this, 'POST', `/chat/${chatId}`, {
                        type: 'text',
                        message,
                    });
                    result = {
                        contact: { ...contact, created },
                        chat,
                        message: (0, GenericFunctions_1.responseData)(messageResponse),
                    };
                }
                else {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Operação não implementada: ${operation}`, { itemIndex });
                }
                output.push({ json: result, pairedItem: itemIndex });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    output.push({ json: { error: error.message }, pairedItem: itemIndex });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, { itemIndex });
            }
        }
        return [output];
    }
}
exports.UnderChat = UnderChat;
