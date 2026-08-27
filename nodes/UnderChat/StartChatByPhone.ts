import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	JsonObject,
	ResourceMapperFields,
	ResourceMapperValue,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	collectionRecords,
	firstRecord,
	getOpaqueId,
	isNotFoundError,
	parseJsonArray,
	parseJsonObject,
	responseData,
	underChatApiMultipartRequest,
	underChatApiRequest,
	withoutEmptyValues,
} from './GenericFunctions';

type OfficialComponentType = 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTON';

interface OfficialVariable {
	key: string;
	componentType: OfficialComponentType;
	index: number;
	parameterName?: string | null;
	buttonIndex?: number | null;
	sample?: string | null;
}

interface ApprovedTemplate {
	name: string;
	language: string;
	status: 'APPROVED';
	variables: OfficialVariable[];
	preview?: IDataObject;
}

interface OfficialContext {
	isOfficial: boolean;
	requiresTemplate: boolean;
	canSendFreeform: boolean;
	canSendTemplate: boolean;
	templates: ApprovedTemplate[];
	window?: IDataObject;
}

interface StartPrerequisites {
	worker: IDataObject;
	sector: IDataObject;
	isOfficial: boolean;
}

const ACTIVE_CHAT_STATUSES = ['ura', 'queue', 'in_chat', 'ura_output', 'ura_schedule', 'ura_webhook'];
const TEMPLATE_SEPARATOR = '::';

function asRecord(value: unknown): IDataObject | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} não foi informado`);
	return value.trim();
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resourceId(value: unknown): string {
	if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
	if (value && typeof value === 'object' && 'value' in value) {
		const selected = (value as { value?: unknown }).value;
		if (typeof selected === 'string' || typeof selected === 'number') return String(selected).trim();
	}
	return '';
}

function digits(value: unknown, label: string): string {
	const raw = requiredString(String(value ?? ''), label);
	const normalized = raw.replace(/\D/g, '');
	if (!normalized) throw new Error(`${label} deve conter números`);
	return normalized;
}

function recordId(record: IDataObject | undefined, keys: string[]): string | undefined {
	return getOpaqueId(record, keys);
}

function templateSelection(template: Pick<ApprovedTemplate, 'name' | 'language'>): string {
	return `${template.name}${TEMPLATE_SEPARATOR}${template.language}`;
}

function parseTemplateSelection(value: unknown): { name: string; language: string } | undefined {
	const selected = resourceId(value);
	if (!selected) return undefined;
	const separator = selected.lastIndexOf(TEMPLATE_SEPARATOR);
	if (separator <= 0 || separator >= selected.length - TEMPLATE_SEPARATOR.length) {
		throw new Error('Informe o template no formato nome::idioma');
	}
	return {
		name: selected.slice(0, separator).trim(),
		language: selected.slice(separator + TEMPLATE_SEPARATOR.length).trim(),
	};
}

function variableFieldId(variable: OfficialVariable): string {
	return `variable_${encodeURIComponent(
		JSON.stringify([
			variable.key,
			variable.componentType,
			variable.index,
			variable.parameterName ?? null,
			variable.buttonIndex ?? null,
		]),
	)}`;
}

function parseVariable(value: unknown, templateLabel: string): OfficialVariable {
	const record = asRecord(value);
	if (!record) throw new Error(`Variável inválida no template ${templateLabel}`);
	const componentType = requiredString(record.component_type, 'Tipo da variável').toUpperCase();
	if (!['HEADER', 'BODY', 'FOOTER', 'BUTTON'].includes(componentType)) {
		throw new Error(`Tipo de variável inválido no template ${templateLabel}`);
	}
	const index = Number(record.index);
	if (!Number.isInteger(index) || index < 0) {
		throw new Error(`Índice de variável inválido no template ${templateLabel}`);
	}
	const buttonIndex = record.button_index == null ? undefined : Number(record.button_index);
	if (buttonIndex !== undefined && (!Number.isInteger(buttonIndex) || buttonIndex < 0)) {
		throw new Error(`Índice de botão inválido no template ${templateLabel}`);
	}
	return {
		key: requiredString(record.key, 'Chave da variável'),
		componentType: componentType as OfficialComponentType,
		index,
		parameterName: optionalString(record.parameter_name) ?? null,
		buttonIndex: buttonIndex ?? null,
		sample: optionalString(record.sample) ?? null,
	};
}

function parseTemplate(value: unknown): ApprovedTemplate | undefined {
	const record = asRecord(value);
	if (!record || record.status !== 'APPROVED') return undefined;
	const name = optionalString(record.name);
	const language = optionalString(record.language);
	if (!name || !language || !Array.isArray(record.variables)) return undefined;
	const label = `${name} (${language})`;
	return {
		name,
		language,
		status: 'APPROVED',
		variables: record.variables.map((variable) => parseVariable(variable, label)),
		preview: asRecord(record.preview),
	};
}

function parseOfficialContext(response: IDataObject): OfficialContext {
	const data = asRecord(responseData(response));
	if (!data || typeof data.is_official !== 'boolean' || !Array.isArray(data.templates)) {
		throw new Error('A API retornou um contexto oficial inválido');
	}
	const window = asRecord(data.official_window);
	const canSendFreeform = window?.can_send_freeform === true;
	const canSendTemplate = window?.can_send_template === true;
	return {
		isOfficial: data.is_official,
		requiresTemplate:
			typeof data.requires_template === 'boolean'
				? data.requires_template
				: data.is_official && !canSendFreeform,
		canSendFreeform,
		canSendTemplate,
		templates: data.templates
			.map(parseTemplate)
			.filter((template): template is ApprovedTemplate => template !== undefined),
		window,
	};
}

async function currentExecutor(this: ILoadOptionsFunctions): Promise<string> {
	const selected = this.getCurrentNodeParameter('executorId', { extractValue: true });
	const id = resourceId(selected);
	if (id) return id;
	const credentials = await this.getCredentials('underChatApi');
	return typeof credentials.userId === 'string' ? credentials.userId : '';
}

async function findContactId(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	executorId: string,
	phoneDdi: string,
	phone: string,
): Promise<string | undefined> {
	try {
		const response = await underChatApiRequest.call(
			context,
			'GET',
			'/chat/contacts/by-phone',
			{},
			{ phone_ddi: phoneDdi, phone },
			executorId,
		);
		return recordId(firstRecord(response), ['contact_id', 'id']);
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw new NodeApiError(context.getNode(), error as JsonObject);
	}
}

function findById(response: IDataObject, id: string, keys: string[]): IDataObject | undefined {
	return collectionRecords(response).find((record) => recordId(record, keys) === id);
}

async function resolvePrerequisites(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	executorId: string,
	workerId: string,
	sectorId: string,
): Promise<StartPrerequisites> {
	const [workersResponse, sectorsResponse] = await Promise.all([
		underChatApiRequest.call(context, 'GET', '/chat/workers', {}, {}, executorId),
		underChatApiRequest.call(context, 'GET', '/chat/sectors', {}, {}, executorId),
	]);
	const worker = findById(workersResponse, workerId, ['worker_id', 'id']);
	if (!worker) throw new Error('O canal selecionado não está disponível para o executor');
	const sector = findById(sectorsResponse, sectorId, ['sector_id', 'id']);
	if (!sector) throw new Error('O setor selecionado não está disponível para o executor');
	return { worker, sector, isOfficial: worker.is_official === true };
}

async function loadOfficialContextFromCurrent(
	context: ILoadOptionsFunctions,
): Promise<{ context: OfficialContext; contactId: string } | undefined> {
	const executorId = await currentExecutor.call(context);
	const workerId = resourceId(context.getCurrentNodeParameter('workerId', { extractValue: true }));
	const sectorId = resourceId(context.getCurrentNodeParameter('sectorId', { extractValue: true }));
	const rawPhone = context.getCurrentNodeParameter('phone');
	const rawPhoneDdi = context.getCurrentNodeParameter('phoneDdi');
	if (!executorId || !workerId || !sectorId) return undefined;
	const prerequisites = await resolvePrerequisites(context, executorId, workerId, sectorId);
	if (!prerequisites.isOfficial) return undefined;

	let contactId: string | undefined;
	if (
		typeof rawPhone === 'string' &&
		typeof rawPhoneDdi === 'string' &&
		!rawPhone.includes('{{') &&
		!rawPhoneDdi.includes('{{')
	) {
		const phone = rawPhone.replace(/\D/g, '');
		const phoneDdi = rawPhoneDdi.replace(/\D/g, '');
		if (phone && phoneDdi) contactId = await findContactId(context, executorId, phoneDdi, phone);
	}

	// O endpoint público de templates exige contact_id. Quando o telefone do item é
	// dinâmico ou o contato ainda não existe, usamos somente para descoberta um
	// contato já vinculado ao canal. A execução sempre revalida o template com o
	// contato real antes de qualquer escrita.
	if (!contactId) {
		const contactsResponse = await underChatApiRequest.call(
			context,
			'GET',
			'/chat/contacts',
			{},
			{ current_page: 1, per_page: 1, filter_channel_id: workerId },
			executorId,
		);
		contactId = recordId(collectionRecords(contactsResponse)[0], ['contact_id', 'id']);
	}
	if (!contactId) return undefined;
	const response = await underChatApiRequest.call(
		context,
		'GET',
		'/chat/official-opening/context',
		{},
		{ worker_id: workerId, contact_id: contactId },
		executorId,
	);
	return { context: parseOfficialContext(response), contactId };
}

function templatePreview(template: ApprovedTemplate): string | undefined {
	const body = optionalString(template.preview?.body);
	if (!body) return undefined;
	return body.length > 70 ? `${body.slice(0, 67)}...` : body;
}

export async function searchOfficialTemplates(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const loaded = await loadOfficialContextFromCurrent(this);
	if (!loaded) return { results: [] };
	const normalizedFilter = filter?.trim().toLocaleLowerCase('pt-BR') ?? '';
	const results: INodeListSearchItems[] = loaded.context.templates
		.filter((template) => {
			const searchable = `${template.name} ${template.language} ${templatePreview(template) ?? ''}`
				.toLocaleLowerCase('pt-BR');
			return !normalizedFilter || searchable.includes(normalizedFilter);
		})
		.map((template) => ({
			name: `${template.name} · ${template.language} · ${template.variables.length} variável${
				template.variables.length === 1 ? '' : 'is'
			}`,
			value: templateSelection(template),
		}));
	return { results };
}

export async function getOfficialTemplateVariables(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const selected = parseTemplateSelection(this.getCurrentNodeParameter('officialTemplate', { extractValue: true }));
	if (!selected) {
		return { fields: [], emptyFieldsNotice: 'Selecione um template oficial para carregar as variáveis.' };
	}
	const loaded = await loadOfficialContextFromCurrent(this);
	if (!loaded) {
		return {
			fields: [],
			emptyFieldsNotice:
				'Não há um contato de referência neste canal para carregar as variáveis. Use o modo JSON avançado; a execução validará tudo com o contato real.',
		};
	}
	const template = loaded.context.templates.find(
		(candidate) => candidate.name === selected.name && candidate.language === selected.language,
	);
	if (!template) return { fields: [], emptyFieldsNotice: 'O template selecionado não está aprovado para este canal.' };
	return {
		fields: template.variables.map((variable) => ({
			id: variableFieldId(variable),
			displayName: `${variable.componentType} ${variable.key}${
				variable.sample ? ` — exemplo: ${variable.sample}` : ''
			}`,
			defaultMatch: false,
			canBeUsedToMatch: false,
			required: true,
			display: true,
			type: 'string',
		})),
		emptyFieldsNotice: 'Este template não possui variáveis.',
	};
}

function selectTemplate(context: OfficialContext, selectionValue: unknown): ApprovedTemplate | undefined {
	const selected = parseTemplateSelection(selectionValue);
	if (!selected) {
		const automatic = context.templates.filter((template) => template.variables.length === 0);
		if (context.requiresTemplate && automatic.length === 1) return automatic[0];
		return undefined;
	}
	return context.templates.find(
		(template) => template.name === selected.name && template.language === selected.language,
	);
}

function variableIdentity(variable: OfficialVariable): IDataObject {
	return withoutEmptyValues({
		key: variable.key,
		component_type: variable.componentType,
		index: variable.index,
		parameter_name: variable.parameterName ?? undefined,
		button_index: variable.buttonIndex ?? undefined,
	});
}

function validateManualVariables(template: ApprovedTemplate, raw: IDataObject[]): IDataObject[] {
	if (raw.length !== template.variables.length) {
		throw new Error(`O template ${template.name} exige ${template.variables.length} variável(is)`);
	}
	return template.variables.map((variable) => {
		const expected = variableIdentity(variable);
		const match = raw.find((candidate) =>
			Object.entries(expected).every(([key, value]) => candidate[key] === value),
		);
		if (!match || (typeof match.value !== 'string' && typeof match.value !== 'number')) {
			throw new Error(`Preencha a variável ${variable.componentType} ${variable.key}`);
		}
		return { ...expected, value: match.value };
	});
}

function mappedVariables(template: ApprovedTemplate, raw: unknown): IDataObject[] {
	const mapper = asRecord(raw) as ResourceMapperValue | undefined;
	const values = asRecord(mapper?.value);
	if (!values && template.variables.length > 0) throw new Error('Preencha as variáveis do template');
	return template.variables.map((variable) => {
		const value = values?.[variableFieldId(variable)];
		if (typeof value !== 'string' && typeof value !== 'number') {
			throw new Error(`Preencha a variável ${variable.componentType} ${variable.key}`);
		}
		if (typeof value === 'string' && !value.trim()) {
			throw new Error(`Preencha a variável ${variable.componentType} ${variable.key}`);
		}
		return { ...variableIdentity(variable), value };
	});
}

function buildOfficialTemplate(
	template: ApprovedTemplate,
	inputMode: string,
	rawMapper: unknown,
	rawJson: string,
): IDataObject {
	const variables =
		inputMode === 'json'
			? validateManualVariables(template, parseJsonArray(rawJson))
			: mappedVariables(template, rawMapper);
	return { name: template.name, language: template.language, variables };
}

async function findActiveChat(
	context: IExecuteFunctions,
	executorId: string,
	contactId: string,
	phone: string,
	workerId: string,
	sectorId: string,
): Promise<IDataObject | undefined> {
	const response = await underChatApiRequest.call(
		context,
		'GET',
		'/chat',
		{},
		{
			status: ACTIVE_CHAT_STATUSES,
			filter_phone: phone,
			filter_worker_id: workerId,
			current_page: 1,
			per_page: 200,
		},
		executorId,
	);
	const matches = collectionRecords(response).filter((chat) => {
		const contact = asRecord(chat.contact);
		const worker = asRecord(chat.worker);
		return recordId(contact, ['contact_id', 'id']) === contactId && recordId(worker, ['worker_id', 'id']) === workerId;
	});
	if (matches.length > 1) throw new Error('Existe mais de um atendimento ativo para este contato e canal');
	const chat = matches[0];
	if (!chat) return undefined;
	const chatSectorId = recordId(asRecord(chat.sector), ['sector_id', 'id']);
	if (chatSectorId !== sectorId) {
		throw new Error(
			'O contato já possui um atendimento ativo neste canal, mas em outro setor. Selecione o setor atual ou use a operação de transferência.',
		);
	}
	return chat;
}

function templateChoices(context: OfficialContext): string {
	return context.templates
		.slice(0, 10)
		.map((template) => `${template.name}::${template.language} (${template.variables.length} variável(is))`)
		.join(', ');
}

export async function executeStartChatByPhone(
	this: IExecuteFunctions,
	itemIndex: number,
	executorId: string,
): Promise<IDataObject> {
	try {
		const phoneDdi = digits(this.getNodeParameter('phoneDdi', itemIndex), 'DDI');
		const phone = digits(this.getNodeParameter('phone', itemIndex), 'Telefone');
		const contactName = optionalString(this.getNodeParameter('contactName', itemIndex, ''));
		const workerId = resourceId(this.getNodeParameter('workerId', itemIndex, ''));
		const sectorId = resourceId(this.getNodeParameter('sectorId', itemIndex, ''));
		const createIfMissing = this.getNodeParameter('createIfMissing', itemIndex, true) as boolean;
		if (!workerId) throw new Error('Selecione o canal');
		if (!sectorId) throw new Error('Selecione o setor');
		const prerequisites = await resolvePrerequisites(this, executorId, workerId, sectorId);

		let contactId = await findContactId(this, executorId, phoneDdi, phone);
		let contactCreated = false;
		if (!contactId) {
			if (!createIfMissing) throw new Error('Contato não encontrado');
			if (!contactName) throw new Error('Informe o nome para cadastrar o novo contato');
			const extra = parseJsonObject(
				this.getNodeParameter('additionalFields', itemIndex, '{}') as string,
			);
			await underChatApiMultipartRequest.call(
				this,
				'/chat/contacts',
				withoutEmptyValues({
					...extra,
					name: contactName,
					phone_ddi: phoneDdi,
					phone,
					channel_ids: [workerId],
				}),
				executorId,
			);
			contactId = await findContactId(this, executorId, phoneDdi, phone);
			contactCreated = true;
		}
		if (!contactId) throw new Error('A API não retornou o ID do contato após o cadastro');

		const existingChat = await findActiveChat(
			this,
			executorId,
			contactId,
			phone,
			workerId,
			sectorId,
		);
		let officialContext: OfficialContext | undefined;
		if (prerequisites.isOfficial) {
			const contextResponse = await underChatApiRequest.call(
				this,
				'GET',
				existingChat
					? `/chat/${recordId(existingChat, ['chat_id', 'id'])}/official-conversation/context`
					: '/chat/official-opening/context',
				{},
				existingChat ? {} : { worker_id: workerId, contact_id: contactId },
				executorId,
			);
			officialContext = parseOfficialContext(contextResponse);
		}

		const selectionValue = this.getNodeParameter('officialTemplate', itemIndex, '') as unknown;
		if (!prerequisites.isOfficial && resourceId(selectionValue)) {
			throw new Error('Template oficial não pode ser usado em um canal não oficial');
		}
		const selectedTemplate = officialContext
			? selectTemplate(officialContext, selectionValue)
			: undefined;
		if (officialContext && parseTemplateSelection(selectionValue) && !selectedTemplate) {
			throw new Error('O template selecionado não está aprovado para este canal');
		}
		if (officialContext?.requiresTemplate && !selectedTemplate) {
			throw new Error(
				`Este canal exige um template oficial. Selecione uma opção aprovada: ${templateChoices(officialContext) || 'nenhum template disponível'}`,
			);
		}
		if (selectedTemplate && officialContext?.canSendTemplate !== true) {
			throw new Error('A janela oficial não permite enviar template neste momento');
		}
		const inputMode = this.getNodeParameter('templateVariableInputMode', itemIndex, 'fields') as string;
		const officialTemplate = selectedTemplate
			? buildOfficialTemplate(
					selectedTemplate,
					inputMode,
					this.getNodeParameter('officialTemplateVariables', itemIndex, {}),
					this.getNodeParameter('officialTemplateVariablesJson', itemIndex, '[]') as string,
				)
			: undefined;

		let chat: IDataObject;
		let chatCreated = false;
		let templateSent = false;
		if (existingChat) {
			chat = existingChat;
			const chatId = requiredString(recordId(chat, ['chat_id', 'id']), 'Chat ID');
			if (officialTemplate) {
				const response = await underChatApiRequest.call(
					this,
					'POST',
					`/chat/${chatId}/official-template`,
					officialTemplate,
					{},
					executorId,
				);
				chat = firstRecord(response) ?? chat;
				templateSent = true;
			}
		} else {
			const response = await underChatApiRequest.call(
				this,
				'POST',
				'/chat/start-with-contact',
				{
					contact_id: contactId,
					worker_id: workerId,
					sector_id: sectorId,
					...(officialTemplate ? { official_template: officialTemplate } : {}),
				},
				{},
				executorId,
			);
			chat = firstRecord(response) ?? {};
			chatCreated = true;
			templateSent = Boolean(officialTemplate);
		}
		const chatId = recordId(chat, ['chat_id', 'id']);
		if (!chatId) throw new Error('A API não retornou o ID do atendimento');

		return {
			contact_id: contactId,
			contact_created: contactCreated,
			chat_id: chatId,
			chat_created: chatCreated,
			chat_reused: !chatCreated,
			worker: asRecord(chat.worker) ?? prerequisites.worker,
			sector: asRecord(chat.sector) ?? prerequisites.sector,
			official: prerequisites.isOfficial,
			official_window: officialContext?.window ?? null,
			template: selectedTemplate
				? { name: selectedTemplate.name, language: selectedTemplate.language, sent: templateSent }
				: null,
			chat,
		};
	} catch (error) {
		throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
	}
}
