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

import { executeBusinessHours } from './BusinessHours';
import { businessHoursProperties } from './BusinessHoursDescription';

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

function attendantHasEntered(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const enteredAt = (value as IDataObject).entered_at;
	return typeof enteredAt === 'string' ? enteredAt.trim().length > 0 : enteredAt != null;
}

function attendanceHasStarted(response: IDataObject): boolean {
	const data = responseData(response);
	if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

	const attendants = data as IDataObject;
	if (attendantHasEntered(attendants.primary_user)) return true;

	const secondaryUsers = attendants.secondary_users;
	return Array.isArray(secondaryUsers) && secondaryUsers.some(attendantHasEntered);
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
		const firstName = recordText(record, nameKeys);
		const lastName = recordText(record, [
			'last_name',
			'lastName',
			'user_last_name',
			'userLastName',
			'surname',
			'family_name',
			'familyName',
		]);
		const name =
			firstName && lastName && !firstName.toLocaleLowerCase('pt-BR').includes(lastName.toLocaleLowerCase('pt-BR'))
				? `${firstName} ${lastName}`
				: firstName || lastName || value;
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
		[
			'full_name',
			'fullName',
			'display_name',
			'displayName',
			'name',
			'first_name',
			'firstName',
			'user_name',
			'userName',
			'email',
		],
	);
}

async function searchWorkers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const executorId = await executorForSearch.call(this);
	if (!executorId) return { results: [] };
	const response = await underChatApiRequest.call(
		this,
		'GET',
		'/chat/workers',
		{},
		{},
		executorId,
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
	const executorId = await executorForSearch.call(this);
	if (!executorId) return { results: [] };
	const operation = String(this.getCurrentNodeParameter('operation') ?? '');
	const endpoint = operation === 'transferChat' ? '/chat/transfer/sectors' : '/chat/sectors';
	const response = await underChatApiRequest.call(
		this,
		'GET',
		endpoint,
		{},
		{},
		executorId,
	);
	return searchableResults(response, filter, ['sector_id', 'id'], ['name', 'sector_name']);
}

async function searchUsers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const executorId = await executorForSearch.call(this);
	if (!executorId) return { results: [] };
	const response = await underChatApiRequest.call(
		this,
		'GET',
		'/chat/transfer/users',
		{},
		{},
		executorId,
	);
	return searchableResults(
		response,
		filter,
		['user_id', 'id'],
		[
			'full_name',
			'fullName',
			'display_name',
			'displayName',
			'name',
			'first_name',
			'firstName',
			'user_name',
			'userName',
			'email',
		],
	);
}

export class UnderChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UnderChat',
		name: 'underChat',
		icon: { light: 'file:underchat-logo.svg', dark: 'file:underchat-logo.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Gerencie contatos, atendimentos e mensagens pela UnderChat',
		subtitle: '={{$parameter["operation"]}}',
		defaults: { name: 'UnderChat' },
		inputs: [NodeConnectionTypes.Main],
		outputs:
			'={{ $parameter.resource === "businessHours" ? [{ type: "main", displayName: "Dentro do horário" }, { type: "main", displayName: "Fora do horário" }] : ["main"] }}',
		usableAsTool: true,
		credentials: [
			{
				name: 'underChatApi',
				required: true,
				displayOptions: { hide: { resource: ['businessHours'] } },
			},
		],
		properties: [
			{
				displayName: 'Recurso',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Atendimento', value: 'chat' },
					{ name: 'Contato', value: 'contact' },
					{
						name: 'Horário De Funcionamento',
						value: 'businessHours',
						displayOptions: { hide: { '@tool': [true] } },
					},
					{ name: 'Listar', value: 'directory' },
					{ name: 'Mensagem', value: 'message' },
				],
				default: 'message',
			},
			...businessHoursProperties,
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Buscar ID Do Contato Pelo Telefone',
						value: 'findContactByPhone',
						action: 'Buscar ID do contato pelo telefone',
					},
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
					{
						name: 'Entrar No Atendimento',
						value: 'enterAttendance',
						action: 'Entrar no atendimento',
					},
					{
						name: 'Transferir Para Setor Ou Usuário',
						value: 'transferChat',
						action: 'Transferir chat para setor ou usuario',
					},
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
				displayOptions: {
					hide: { operation: ['listExecutors'], resource: ['businessHours'] },
				},
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
				typeOptions: { loadOptionsDependsOn: ['executorId.value'] },
				default: { mode: 'list', value: '' },
				description: 'Canal/worker usado para localizar ou iniciar o atendimento',
				displayOptions: showFor(['findContactByPhone', 'createContact', 'sendTextByPhone']),
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
				typeOptions: { loadOptionsDependsOn: ['executorId.value'] },
				default: { mode: 'list', value: '' },
				description: 'Setor inicial opcional para uma nova conversa',
				displayOptions: showFor(['sendTextByPhone']),
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
				displayName: 'Tipo De Destino',
				name: 'transferDestinationType',
				type: 'options',
				options: [
					{ name: 'Setor', value: 'sector' },
					{ name: 'Usuário', value: 'user' },
				],
				default: 'sector',
				displayOptions: showFor(['transferChat']),
			},
			{
				displayName: 'Setor De Destino',
				name: 'destinationSectorId',
				type: 'resourceLocator',
				typeOptions: { loadOptionsDependsOn: ['executorId.value'] },
				default: { mode: 'list', value: '' },
				required: true,
				description: 'Setor que receberá o atendimento',
				displayOptions: {
					show: { operation: ['transferChat'], transferDestinationType: ['sector'] },
				},
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
				name: 'destinationUserId',
				type: 'resourceLocator',
				typeOptions: { loadOptionsDependsOn: ['executorId.value'] },
				default: { mode: 'list', value: '' },
				required: true,
				description: 'Atendente que receberá o chat',
				displayOptions: {
					show: { operation: ['transferChat'], transferDestinationType: ['user'] },
				},
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
				displayOptions: showFor([
					'enterAttendance',
					'sendText',
					'sendOfficialTemplate',
					'transferChat',
				]),
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
				displayName: 'Entrar No Atendimento Antes De Transferir',
				name: 'enterBeforeTransfer',
				type: 'boolean',
				default: false,
				description:
					'Whether to change the chat to in_chat with the selected executor before transferring it',
				displayOptions: showFor(['transferChat']),
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
		if (this.getNodeParameter('resource', 0, 'message') === 'businessHours') {
			return await executeBusinessHours.call(this);
		}
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
					const attendantsResponse = await underChatApiRequest.call(
						this,
						'GET',
						`/chat/${chatId}/attendants`,
						{},
						{},
						executorId,
					);
					if (!attendanceHasStarted(attendantsResponse)) {
						await underChatApiRequest.call(
							this,
							'PATCH',
							`/chat/${chatId}/status`,
							{ status: 'in_chat' },
							{},
							executorId,
						);
					}
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
				} else if (operation === 'enterAttendance') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const response = await underChatApiRequest.call(
						this,
						'PATCH',
						`/chat/${chatId}/status`,
						{ status: 'in_chat' },
						{},
						executorId,
					);
					result = responseData(response);
				} else if (operation === 'transferChat') {
					const chatId = this.getNodeParameter('chatId', itemIndex) as string;
					const destinationType = this.getNodeParameter(
						'transferDestinationType',
						itemIndex,
					) as string;
					const userId =
						destinationType === 'user'
							? resourceId(this.getNodeParameter('destinationUserId', itemIndex, ''))
							: '';
					const sectorId =
						destinationType === 'sector'
							? resourceId(this.getNodeParameter('destinationSectorId', itemIndex, ''))
							: '';
					const enterBeforeTransfer = this.getNodeParameter(
						'enterBeforeTransfer',
						itemIndex,
					) as boolean;
					const annotation = this.getNodeParameter('annotation', itemIndex, '') as string;
					const keepInChat = this.getNodeParameter('keepInChat', itemIndex) as boolean;
					const sendMessageOnTransfer = this.getNodeParameter(
						'sendMessageOnTransfer',
						itemIndex,
					) as boolean;
					if (!userId && !sectorId) {
						throw new NodeOperationError(
							this.getNode(),
							'Selecione o setor ou usuário de destino',
							{ itemIndex },
						);
					}
					if (enterBeforeTransfer) {
						await underChatApiRequest.call(
							this,
							'PATCH',
							`/chat/${chatId}/status`,
							{ status: 'in_chat' },
							{},
							executorId,
						);
					}
					const response = await underChatApiRequest.call(
						this,
						'POST',
						`/chat/${chatId}/transfer`,
						withoutEmptyValues({
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
