import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	firstRecord,
	getOpaqueId,
	isNotFoundError,
	parseJsonArray,
	parseJsonObject,
	responseData,
	underChatApiRequest,
	withoutEmptyValues,
} from './GenericFunctions';

const showFor = (operations: string[]) => ({ show: { operation: operations } });

export class UnderChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UnderChat',
		name: 'underChat',
		icon: { light: 'file:underchat.svg', dark: 'file:underchat.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Gerencie contatos e envie mensagens pela UnderChat',
		subtitle: '={{$parameter["operation"]}}',
		defaults: { name: 'UnderChat' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
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
				displayName: 'DDI',
				name: 'phoneDdi',
				type: 'string',
				default: '55',
				required: true,
				description: 'Código do país sem o sinal de mais',
				displayOptions: showFor(['findContactByPhone', 'createContact', 'sendTextByPhone']),
			},
			{
				displayName: 'Telefone',
				name: 'phone',
				type: 'string',
				default: '',
				required: true,
				description: 'DDD e número, contendo somente números e sem o DDI',
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let result: unknown;

				if (operation === 'findContactByPhone') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const workerId = this.getNodeParameter('workerId', itemIndex, '') as string;
					const response = await underChatApiRequest.call(
						this,
						'GET',
						'/chat/contacts/by-phone',
						{},
						withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
					);
					result = responseData(response);
				} else if (operation === 'createContact') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const name = this.getNodeParameter('contactName', itemIndex) as string;
					const workerId = this.getNodeParameter('workerId', itemIndex, '') as string;
					const extra = parseJsonObject(
						this.getNodeParameter('additionalFields', itemIndex, '{}') as string,
					);
					await underChatApiRequest.call(
						this,
						'POST',
						'/chat/contacts',
						withoutEmptyValues({ name, phone_ddi: phoneDdi, phone, worker_id: workerId, ...extra }),
					);
					const foundResponse = await underChatApiRequest.call(
						this,
						'GET',
						'/chat/contacts/by-phone',
						{},
						withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
					);
					result = responseData(foundResponse);
				} else if (operation === 'sendText') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const message = this.getNodeParameter('message', itemIndex) as string;
					const response = await underChatApiRequest.call(this, 'POST', `/chat/${chatId}`, {
						type: 'text',
						message,
					});
					result = responseData(response);
				} else if (operation === 'sendOfficialTemplate') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const name = this.getNodeParameter('templateName', itemIndex) as string;
					const language = this.getNodeParameter('templateLanguage', itemIndex) as string;
					const variables = parseJsonArray(
						this.getNodeParameter('templateVariables', itemIndex, '[]') as string,
					);
					const response = await underChatApiRequest.call(
						this,
						'POST',
						`/chat/${chatId}/official-template`,
						{ name, language, variables },
					);
					result = responseData(response);
				} else if (operation === 'sendTextByPhone') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const name = this.getNodeParameter('contactName', itemIndex, '') as string;
					const message = this.getNodeParameter('message', itemIndex) as string;
					const workerId = this.getNodeParameter('workerId', itemIndex) as string;
					const sectorId = this.getNodeParameter('sectorId', itemIndex, '') as string;
					const createIfMissing = this.getNodeParameter('createIfMissing', itemIndex) as boolean;
					const extra = parseJsonObject(
						this.getNodeParameter('additionalFields', itemIndex, '{}') as string,
					);
					let contact;
					try {
						const foundResponse = await underChatApiRequest.call(
							this,
							'GET',
							'/chat/contacts/by-phone',
							{},
							withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
						);
						contact = firstRecord(foundResponse);
					} catch (error) {
						if (!isNotFoundError(error)) {
							throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
						}
					}
					let created = false;

					if (!getOpaqueId(contact, ['contact_id', 'id'])) {
						if (!createIfMissing) throw new NodeOperationError(this.getNode(), 'Contato não encontrado', { itemIndex });
						if (!name) throw new NodeOperationError(this.getNode(), 'Informe o nome para criar o contato', { itemIndex });
						await underChatApiRequest.call(
							this,
							'POST',
							'/chat/contacts',
							withoutEmptyValues({ name, phone_ddi: phoneDdi, phone, worker_id: workerId, ...extra }),
						);
						const refreshedResponse = await underChatApiRequest.call(
							this,
							'GET',
							'/chat/contacts/by-phone',
							{},
							withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
						);
						contact = firstRecord(refreshedResponse);
						created = true;
					}

					const contactId = getOpaqueId(contact, ['contact_id', 'id']);
					if (!contactId) throw new NodeOperationError(this.getNode(), 'A API não retornou o ID do contato', { itemIndex });
					if (!workerId) throw new NodeOperationError(this.getNode(), 'Informe o Worker ID para iniciar a conversa', { itemIndex });

					const startedResponse = await underChatApiRequest.call(
						this,
						'POST',
						'/chat/start-with-contact',
						withoutEmptyValues({ contact_id: contactId, worker_id: workerId, sector_id: sectorId }),
					);
					const chat = firstRecord(startedResponse);
					const chatId = getOpaqueId(chat, ['chat_id', 'id']);
					if (!chatId) throw new NodeOperationError(this.getNode(), 'A API não retornou o ID do chat', { itemIndex });

					const messageResponse = await underChatApiRequest.call(this, 'POST', `/chat/${chatId}`, {
						type: 'text',
						message,
					});
					result = {
						contact: { ...contact, created },
						chat,
						message: responseData(messageResponse),
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Operação não implementada: ${operation}`, { itemIndex });
				}

				output.push({ json: result as INodeExecutionData['json'], pairedItem: itemIndex });
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: { error: (error as Error).message }, pairedItem: itemIndex });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [output];
	}
}
