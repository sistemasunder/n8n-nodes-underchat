import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchItems,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	collectionRecords,
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

function resourceId(value: unknown): string {
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (value && typeof value === 'object' && 'value' in value) {
		const selected = (value as { value?: unknown }).value;
		if (typeof selected === 'string' || typeof selected === 'number') return String(selected);
	}
	return '';
}

function recordText(record: IDataObject, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' || typeof value === 'number') return String(value);
	}
	return undefined;
}

function searchableResults(
	response: IDataObject,
	filter: string | undefined,
	idKeys: string[],
	nameKeys: string[],
): INodeListSearchResult {
	const normalizedFilter = filter?.trim().toLocaleLowerCase('pt-BR') ?? '';
	const results: INodeListSearchItems[] = [];
	for (const record of collectionRecords(response)) {
		const value = getOpaqueId(record, idKeys);
		if (!value) continue;
		const firstName = recordText(record, nameKeys) ?? value;
		const lastName = recordText(record, ['last_name', 'lastName']);
		const name = lastName && !firstName.includes(lastName) ? `${firstName} ${lastName}` : firstName;
		if (
			!normalizedFilter ||
			name.toLocaleLowerCase('pt-BR').includes(normalizedFilter) ||
			value.toLocaleLowerCase('pt-BR').includes(normalizedFilter)
		) {
			results.push({ name, value });
		}
	}
	return { results };
}

async function executorForSearch(this: ILoadOptionsFunctions): Promise<string> {
	const selected = this.getCurrentNodeParameter('executorId', { extractValue: true });
	const id = resourceId(selected);
	if (id) return id;
	const credentials = await this.getCredentials('underChatApi');
	return typeof credentials.userId === 'string' ? credentials.userId : '';
}

async function searchExecutors(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = await underChatApiRequest.call(this, 'GET', '/user/all');
	return searchableResults(
		response,
		filter,
		['user_id', 'id'],
		['name', 'display_name', 'full_name', 'email'],
	);
}

async function searchWorkers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = await underChatApiRequest.call(
		this,
		'GET',
		'/chat/workers',
		{},
		{},
		await executorForSearch.call(this),
	);
	return searchableResults(
		response,
		filter,
		['worker_id', 'id'],
		['name', 'worker_name', 'channel_name', 'phone_name'],
	);
}

async function searchSectors(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const operation = String(this.getCurrentNodeParameter('operation') ?? '');
	const endpoint = operation === 'transferChat' ? '/chat/transfer/sectors' : '/chat/sectors';
	const response = await underChatApiRequest.call(
		this,
		'GET',
		endpoint,
		{},
		{},
		await executorForSearch.call(this),
	);
	return searchableResults(response, filter, ['sector_id', 'id'], ['name', 'sector_name']);
}

async function searchUsers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = await underChatApiRequest.call(
		this,
		'GET',
		'/chat/transfer/users',
		{},
		{},
		await executorForSearch.call(this),
	);
	return searchableResults(
		response,
		filter,
		['user_id', 'id'],
		['name', 'display_name', 'full_name', 'email'],
	);
}

export class UnderChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UnderChat',
		name: 'underChat',
		icon: { light: 'file:underchat-logo.svg', dark: 'file:underchat-logo.dark.svg' },
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
				displayName: 'Recurso',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Chat', value: 'chat' },
					{ name: 'Contato', value: 'contact' },
					{ name: 'Diretório', value: 'directory' },
					{ name: 'Mensagem', value: 'message' },
				],
				default: 'message',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Buscar Contato Por Telefone', value: 'findContactByPhone', action: 'Buscar contato por telefone' },
					{ name: 'Criar Contato', value: 'createContact', action: 'Criar contato' },
				],
				default: 'findContactByPhone',
				displayOptions: { show: { resource: ['contact'] } },
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Listar Executores', value: 'listExecutors', action: 'Listar executores' },
					{ name: 'Listar Setores', value: 'listSectors', action: 'Listar setores' },
					{ name: 'Listar Usuários', value: 'listUsers', action: 'Listar usuarios' },
				],
				default: 'listExecutors',
				displayOptions: { show: { resource: ['directory'] } },
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Enviar Mensagem Por Chat ID', value: 'sendText', action: 'Enviar mensagem por chat ID' },
					{ name: 'Enviar Mensagem Por Telefone', value: 'sendTextByPhone', action: 'Enviar mensagem por telefone' },
					{ name: 'Enviar Template Oficial', value: 'sendOfficialTemplate', action: 'Enviar template oficial' },
				],
				default: 'sendTextByPhone',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Transferir Chat', value: 'transferChat', action: 'Transferir chat' },
				],
				default: 'transferChat',
				displayOptions: { show: { resource: ['chat'] } },
			},
			{
				displayName: 'Executor',
				name: 'executorId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				description: 'Usuário executor enviado no header x-underchat-user-ID',
				displayOptions: { hide: { operation: ['listExecutors'] } },
				modes: [
					{
						displayName: 'Da Lista',
						name: 'list',
						type: 'list',
						placeholder: 'Buscar executor...',
						typeOptions: {
							searchListMethod: 'searchExecutors',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'Por ID',
						name: 'id',
						type: 'string',
						placeholder: 'UUID do usuário executor',
					},
				],
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
				displayName: 'Worker',
				name: 'workerId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				description: 'Canal/worker usado para localizar, iniciar ou transferir o atendimento',
				displayOptions: showFor(['findContactByPhone', 'createContact', 'sendTextByPhone', 'transferChat']),
				modes: [
					{
						displayName: 'Da Lista',
						name: 'list',
						type: 'list',
						placeholder: 'Buscar worker...',
						typeOptions: {
							searchListMethod: 'searchWorkers',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'Por ID',
						name: 'id',
						type: 'string',
						placeholder: 'UUID do worker',
					},
				],
			},
			{
				displayName: 'Criar Se Não Existir',
				name: 'createIfMissing',
				type: 'boolean',
				default: true,
				displayOptions: showFor(['sendTextByPhone']),
			},
			{
				displayName: 'Setor',
				name: 'sectorId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				description: 'Setor inicial opcional para uma nova conversa',
				displayOptions: showFor(['sendTextByPhone', 'transferChat']),
				modes: [
					{
						displayName: 'Da Lista',
						name: 'list',
						type: 'list',
						placeholder: 'Buscar setor...',
						typeOptions: {
							searchListMethod: 'searchSectors',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'Por ID',
						name: 'id',
						type: 'string',
						placeholder: 'UUID do setor',
					},
				],
			},
			{
				displayName: 'Usuário De Destino',
				name: 'userId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				description: 'Atendente que receberá o chat; opcional quando outro destino for informado',
				displayOptions: showFor(['transferChat']),
				modes: [
					{
						displayName: 'Da Lista',
						name: 'list',
						type: 'list',
						placeholder: 'Buscar usuário...',
						typeOptions: {
							searchListMethod: 'searchUsers',
							searchable: true,
							searchFilterRequired: false,
						},
					},
					{
						displayName: 'Por ID',
						name: 'id',
						type: 'string',
						placeholder: 'UUID do usuário',
					},
				],
			},
			{
				displayName: 'Chat ID',
				name: 'chatId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: showFor(['sendText', 'sendOfficialTemplate', 'transferChat']),
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
				displayName: 'Busca',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Texto para filtrar usuários; para setores, filtra pelo nome',
				displayOptions: showFor(['listUsers', 'listSectors']),
			},
			{
				displayName: 'Página',
				name: 'currentPage',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				displayOptions: showFor(['listUsers', 'listSectors']),
			},
			{
				displayName: 'Itens Por Página',
				name: 'perPage',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 50,
				displayOptions: showFor(['listUsers', 'listSectors']),
			},
			{
				displayName: 'Anotação',
				name: 'annotation',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Contexto interno opcional para a transferência',
				displayOptions: showFor(['transferChat']),
			},
			{
				displayName: 'Manter Executor No Chat',
				name: 'keepInChat',
				type: 'boolean',
				default: false,
				displayOptions: showFor(['transferChat']),
			},
			{
				displayName: 'Enviar Mensagem Automática Na Transferência',
				name: 'sendMessageOnTransfer',
				type: 'boolean',
				default: true,
				displayOptions: showFor(['transferChat']),
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

	methods = {
		listSearch: {
			searchExecutors,
			searchSectors,
			searchUsers,
			searchWorkers,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const executorSelection = this.getNodeParameter('executorId', itemIndex, '') as unknown;
				const credentials = await this.getCredentials('underChatApi');
				const legacyExecutorId =
					typeof credentials.userId === 'string' ? credentials.userId : '';
				const executorId = resourceId(executorSelection) || legacyExecutorId;
				if (operation !== 'listExecutors' && !executorId) {
					throw new NodeOperationError(this.getNode(), 'Selecione o usuário executor', {
						itemIndex,
					});
				}
				let result: unknown;

				if (operation === 'listExecutors') {
					const response = await underChatApiRequest.call(this, 'GET', '/user/all');
					const data = responseData(response);
					result = Array.isArray(data) ? { results: data } : data;
				} else if (operation === 'listUsers') {
					const currentPage = this.getNodeParameter('currentPage', itemIndex) as number;
					const perPage = this.getNodeParameter('perPage', itemIndex) as number;
					const search = this.getNodeParameter('search', itemIndex, '') as string;
					const response = await underChatApiRequest.call(
						this,
						'GET',
						'/user',
						{},
						withoutEmptyValues({ current_page: currentPage, per_page: perPage, search }),
						executorId,
					);
					result = responseData(response);
				} else if (operation === 'listSectors') {
					const currentPage = this.getNodeParameter('currentPage', itemIndex) as number;
					const perPage = this.getNodeParameter('perPage', itemIndex) as number;
					const name = this.getNodeParameter('search', itemIndex, '') as string;
					const response = await underChatApiRequest.call(
						this,
						'GET',
						'/sector',
						{},
						withoutEmptyValues({ current_page: currentPage, per_page: perPage, name }),
						executorId,
					);
					result = responseData(response);
				} else if (operation === 'findContactByPhone') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const workerId = resourceId(this.getNodeParameter('workerId', itemIndex, ''));
					const response = await underChatApiRequest.call(
						this,
						'GET',
						'/chat/contacts/by-phone',
						{},
						withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
						executorId,
					);
					result = responseData(response);
				} else if (operation === 'createContact') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const name = this.getNodeParameter('contactName', itemIndex) as string;
					const workerId = resourceId(this.getNodeParameter('workerId', itemIndex, ''));
					const extra = parseJsonObject(
						this.getNodeParameter('additionalFields', itemIndex, '{}') as string,
					);
					await underChatApiRequest.call(
						this,
						'POST',
						'/chat/contacts',
						withoutEmptyValues({ name, phone_ddi: phoneDdi, phone, worker_id: workerId, ...extra }),
						{},
						executorId,
					);
					const foundResponse = await underChatApiRequest.call(
						this,
						'GET',
						'/chat/contacts/by-phone',
						{},
						withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
						executorId,
					);
					result = responseData(foundResponse);
				} else if (operation === 'sendText') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const message = this.getNodeParameter('message', itemIndex) as string;
					const response = await underChatApiRequest.call(
						this,
						'POST',
						`/chat/${chatId}`,
						{ type: 'text', message },
						{},
						executorId,
					);
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
						{},
						executorId,
					);
					result = responseData(response);
				} else if (operation === 'sendTextByPhone') {
					const phoneDdi = this.getNodeParameter('phoneDdi', itemIndex) as string;
					const phone = this.getNodeParameter('phone', itemIndex) as string;
					const name = this.getNodeParameter('contactName', itemIndex, '') as string;
					const message = this.getNodeParameter('message', itemIndex) as string;
					const workerId = resourceId(this.getNodeParameter('workerId', itemIndex, ''));
					const sectorId = resourceId(this.getNodeParameter('sectorId', itemIndex, ''));
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
							executorId,
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
							withoutEmptyValues({
								name,
								phone_ddi: phoneDdi,
								phone,
								worker_id: workerId,
								...extra,
							}),
							{},
							executorId,
						);
						const refreshedResponse = await underChatApiRequest.call(
							this,
							'GET',
							'/chat/contacts/by-phone',
							{},
							withoutEmptyValues({ phone_ddi: phoneDdi, phone, worker_id: workerId }),
							executorId,
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
						{},
						executorId,
					);
					const chat = firstRecord(startedResponse);
					const chatId = getOpaqueId(chat, ['chat_id', 'id']);
					if (!chatId) throw new NodeOperationError(this.getNode(), 'A API não retornou o ID do chat', { itemIndex });

					const messageResponse = await underChatApiRequest.call(
						this,
						'POST',
						`/chat/${chatId}`,
						{ type: 'text', message },
						{},
						executorId,
					);
					result = {
						contact: { ...contact, created },
						chat,
						message: responseData(messageResponse),
					};
				} else if (operation === 'transferChat') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const workerId = resourceId(this.getNodeParameter('workerId', itemIndex, ''));
					const userId = resourceId(this.getNodeParameter('userId', itemIndex, ''));
					const sectorId = resourceId(this.getNodeParameter('sectorId', itemIndex, ''));
					const annotation = this.getNodeParameter('annotation', itemIndex, '') as string;
					const keepInChat = this.getNodeParameter('keepInChat', itemIndex) as boolean;
					const sendMessageOnTransfer = this.getNodeParameter(
						'sendMessageOnTransfer',
						itemIndex,
					) as boolean;
					if (!workerId && !userId && !sectorId) {
						throw new NodeOperationError(
							this.getNode(),
							'Selecione ao menos um Worker, Usuário de Destino ou Setor',
							{ itemIndex },
						);
					}
					const response = await underChatApiRequest.call(
						this,
						'POST',
						`/chat/${chatId}/transfer`,
						withoutEmptyValues({
							worker_id: workerId,
							user_id: userId,
							sector_id: sectorId,
							annotation,
							keep_in_chat: keepInChat,
							send_message_on_transfer: sendMessageOnTransfer,
						}),
						{},
						executorId,
					);
					result = responseData(response);
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
