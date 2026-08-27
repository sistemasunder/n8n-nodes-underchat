'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { NodeOperationError } = require('n8n-workflow');
const {
	executeStartChatByPhone,
	getOfficialTemplateVariables,
	searchOfficialTemplates,
} = require('../dist/nodes/UnderChat/StartChatByPhone.js');
const { UnderChat } = require('../dist/nodes/UnderChat/UnderChat.node.js');

const EXECUTOR_ID = 'executor-1';
const WORKER_ID = 'worker-1';
const SECTOR_ID = 'sector-1';
const CONTACT_ID = 'contact-1';
const CHAT_ID = 'chat-1';
const BASE_URL = 'https://underchat.invalid/v1';

const worker = (official = false) => ({
	worker_id: WORKER_ID,
	name: official ? 'Canal Oficial' : 'Canal Web',
	is_official: official,
});
const sector = () => ({ sector_id: SECTOR_ID, name: 'Atendimento' });
const contact = () => ({ contact_id: CONTACT_ID, name: 'Natan Borba' });

const template = ({
	name = 'notifica_usuario',
	language = 'pt_BR',
	status = 'APPROVED',
	variables = [],
	body = 'Mensagem de exemplo',
} = {}) => ({
	name,
	language,
	status,
	variables,
	preview: { body },
});

const bodyVariable = (index, sample, overrides = {}) => ({
	key: `BODY {{${index}}}`,
	component_type: 'BODY',
	index,
	sample,
	...overrides,
});

const variableFieldId = (variable) =>
	`variable_${encodeURIComponent(
		JSON.stringify([
			variable.key,
			String(variable.component_type).toUpperCase(),
			variable.index,
			variable.parameter_name ?? null,
			variable.button_index ?? null,
		]),
	)}`;

function officialContext({
	requiresTemplate = true,
	canSendFreeform = false,
	canSendTemplate = true,
	templates = [],
} = {}) {
	return {
		data: {
			is_official: true,
			requires_template: requiresTemplate,
			official_window: {
				can_send_freeform: canSendFreeform,
				can_send_template: canSendTemplate,
			},
			templates,
		},
	};
}

function notFound() {
	const error = new Error('Contato não encontrado');
	error.statusCode = 404;
	return error;
}

function requestKey(options) {
	const url = new URL(options.url);
	return `${options.method} ${url.pathname.replace(/^\/v1/, '')}`;
}

function apiRouter(routes) {
	const queues = new Map(
		Object.entries(routes).map(([key, values]) => [key, Array.isArray(values) ? [...values] : [values]]),
	);
	return {
		async handle(options) {
			const key = requestKey(options);
			const queue = queues.get(key);
			assert.ok(queue, `requisição inesperada: ${key}`);
			assert.ok(queue.length > 0, `requisição excedente: ${key}`);
			const next = queue.shift();
			if (next instanceof Error) throw next;
			return typeof next === 'function' ? await next(options) : next;
		},
		assertConsumed() {
			for (const [key, queue] of queues) {
				assert.equal(queue.length, 0, `faltou executar ${key} ${queue.length} vez(es)`);
			}
		},
	};
}

function executionFixture({ parameters = {}, routes = {}, items = [{ json: {} }] } = {}) {
	const values = {
		resource: 'chat',
		operation: 'startChatByPhone',
		executorId: { mode: 'list', value: EXECUTOR_ID },
		phoneDdi: '55',
		phone: '64981342084',
		contactName: 'Natan Borba',
		workerId: { mode: 'list', value: WORKER_ID },
		sectorId: { mode: 'list', value: SECTOR_ID },
		createIfMissing: true,
		officialTemplate: { mode: 'list', value: '' },
		templateVariableInputMode: 'fields',
		officialTemplateVariables: { mappingMode: 'defineBelow', value: null },
		officialTemplateVariablesJson: '[]',
		additionalFields: '{}',
		...parameters,
	};
	const requests = [];
	const router = apiRouter(routes);
	const node = {
		id: 'start-chat-test',
		name: 'Iniciar atendimento',
		type: 'n8n-nodes-underchat.underChat',
		typeVersion: 1,
		position: [0, 0],
		parameters: values,
	};
	const context = {
		getNode: () => node,
		getInputData: () => items,
		getNodeParameter: (name, _itemIndex, fallback) =>
			Object.hasOwn(values, name) ? values[name] : fallback,
		async getCredentials(name) {
			assert.equal(name, 'underChatApi');
			return { baseUrl: `${BASE_URL}/`, apiKey: 'chave-ficticia' };
		},
		continueOnFail: () => false,
		helpers: {
			async httpRequestWithAuthentication(name, options) {
				assert.equal(this, context);
				assert.equal(name, 'underChatApi');
				requests.push(options);
				return await router.handle(options);
			},
		},
	};
	return { context, values, requests, router };
}

function loadOptionsFixture({ parameters = {}, routes = {} } = {}) {
	const values = {
		executorId: { mode: 'list', value: EXECUTOR_ID },
		workerId: { mode: 'list', value: WORKER_ID },
		sectorId: { mode: 'list', value: SECTOR_ID },
		phoneDdi: '55',
		phone: '64981342084',
		officialTemplate: { mode: 'list', value: 'notifica_usuario::pt_BR' },
		...parameters,
	};
	const requests = [];
	const router = apiRouter(routes);
	const context = {
		getCurrentNodeParameter(name) {
			return values[name];
		},
		async getCredentials(name) {
			assert.equal(name, 'underChatApi');
			return { baseUrl: BASE_URL, apiKey: 'chave-ficticia' };
		},
		helpers: {
			async httpRequestWithAuthentication(name, options) {
				assert.equal(this, context);
				assert.equal(name, 'underChatApi');
				requests.push(options);
				return await router.handle(options);
			},
		},
	};
	return { context, values, requests, router };
}

function baseRoutes({ official = false, contactResponses = [{ data: contact() }], chats = [] } = {}) {
	return {
		'GET /chat/workers': [{ data: [worker(official)] }],
		'GET /chat/sectors': [{ data: [sector()] }],
		'GET /chat/contacts/by-phone': contactResponses,
		'GET /chat': [{ data: chats }],
	};
}

describe('startChatByPhone — abertura de atendimento', { concurrency: false }, () => {
	test('integra a operação no node, reutiliza o contato e envia canal e setor obrigatórios', async () => {
		const routes = {
			...baseRoutes(),
			'POST /chat/start-with-contact': [
				(options) => {
					assert.deepEqual(options.body, {
						contact_id: CONTACT_ID,
						worker_id: WORKER_ID,
						sector_id: SECTOR_ID,
					});
					return { data: { chat_id: CHAT_ID, status: 'queue' } };
				},
			],
		};
		const fixture = executionFixture({ routes });
		const output = await UnderChat.prototype.execute.call(fixture.context);

		assert.deepEqual(output, [[{
			json: {
				contact_id: CONTACT_ID,
				contact_created: false,
				chat_id: CHAT_ID,
				chat_created: true,
				chat_reused: false,
				worker: worker(false),
				sector: sector(),
				official: false,
				official_window: null,
				template: null,
				chat: { chat_id: CHAT_ID, status: 'queue' },
			},
			pairedItem: 0,
		}]]);

		const lookup = fixture.requests.find((request) => requestKey(request) === 'GET /chat/contacts/by-phone');
		assert.deepEqual(lookup.qs, { phone_ddi: '55', phone: '64981342084' });
		const chatSearch = fixture.requests.find((request) => requestKey(request) === 'GET /chat');
		assert.deepEqual(chatSearch.qs, {
			status: ['ura', 'queue', 'in_chat', 'ura_output', 'ura_schedule', 'ura_webhook'],
			filter_phone: '64981342084',
			filter_worker_id: WORKER_ID,
			current_page: 1,
			per_page: 200,
		});
		assert.ok(fixture.requests.every((request) => request.headers?.['x-underchat-user-id'] === EXECUTOR_ID));
		fixture.router.assertConsumed();
	});

	test('cria o contato ausente por multipart, consulta o ID e só então abre o atendimento', async () => {
		const routes = {
			...baseRoutes({ contactResponses: [notFound(), { data: contact() }] }),
			'POST /chat/contacts': [
				(options) => {
					assert.equal(options.headers['content-type'], 'multipart/form-data');
					assert.deepEqual(options.body, {
						email: 'natan@example.com',
						name: 'Natan Borba',
						phone_ddi: '55',
						phone: '64981342084',
						channel_ids: [WORKER_ID],
					});
					return { data: { created: true } };
				},
			],
			'POST /chat/start-with-contact': [{ data: { chat_id: CHAT_ID } }],
		};
		const fixture = executionFixture({
			parameters: {
				phoneDdi: '+55',
				phone: '(64) 98134-2084',
				additionalFields: JSON.stringify({
					email: 'natan@example.com',
					name: 'não deve substituir',
					channel_ids: ['worker-errado'],
				}),
			},
			routes,
		});

		const result = await executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID);
		assert.equal(result.contact_id, CONTACT_ID);
		assert.equal(result.contact_created, true);
		assert.equal(result.chat_id, CHAT_ID);
		assert.equal(fixture.requests.filter((request) => requestKey(request) === 'GET /chat/contacts/by-phone').length, 2);
		fixture.router.assertConsumed();
	});

	test('exige canal e setor antes de chamar a API, independentemente do tipo do worker', async () => {
		for (const [field, message] of [
			['workerId', /canal/i],
			['sectorId', /setor/i],
		]) {
			const fixture = executionFixture({ parameters: { [field]: { mode: 'list', value: '' } } });
			await assert.rejects(
				executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
				(error) => {
					assert.ok(error instanceof NodeOperationError);
					assert.match(error.message, message);
					assert.equal(error.context.itemIndex, 0);
					return true;
				},
			);
			assert.equal(fixture.requests.length, 0);
		}
	});

	test('não cria contato quando a opção está desligada', async () => {
		const routes = baseRoutes({ contactResponses: [notFound()] });
		delete routes['GET /chat'];
		const fixture = executionFixture({
			parameters: { createIfMissing: false },
			routes,
		});
		await assert.rejects(
			executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
			/Contato não encontrado/,
		);
		assert.equal(fixture.requests.some((request) => requestKey(request) === 'POST /chat/contacts'), false);
		assert.equal(fixture.requests.some((request) => requestKey(request) === 'POST /chat/start-with-contact'), false);
		fixture.router.assertConsumed();
	});

	test('não cadastra contato sem nome e não deixa efeitos parciais', async () => {
		const routes = baseRoutes({ contactResponses: [notFound()] });
		delete routes['GET /chat'];
		const fixture = executionFixture({
			parameters: { contactName: '' },
			routes,
		});
		await assert.rejects(
			executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
			/Informe o nome/,
		);
		assert.equal(fixture.requests.some((request) => request.method === 'POST'), false);
		fixture.router.assertConsumed();
	});

	test('recusa worker ou setor que não pertence ao executor antes de buscar/criar o contato', async () => {
		for (const [routes, message] of [
			[
				{
					'GET /chat/workers': [{ data: [] }],
					'GET /chat/sectors': [{ data: [sector()] }],
				},
				/canal selecionado/i,
			],
			[
				{
					'GET /chat/workers': [{ data: [worker(false)] }],
					'GET /chat/sectors': [{ data: [] }],
				},
				/setor selecionado/i,
			],
		]) {
			const fixture = executionFixture({ routes });
			await assert.rejects(
				executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
				message,
			);
			assert.equal(fixture.requests.some((request) => requestKey(request) === 'GET /chat/contacts/by-phone'), false);
			fixture.router.assertConsumed();
		}
	});
});

describe('startChatByPhone — templates oficiais', { concurrency: false }, () => {
	test('inclui o template e as variáveis mapeadas atomicamente na abertura', async () => {
		const variables = [bodyVariable(1, 'problema'), bodyVariable(2, 'produto')];
		const approved = template({ variables });
		const routes = {
			...baseRoutes({ official: true }),
			'GET /chat/official-opening/context': [officialContext({ templates: [approved] })],
			'POST /chat/start-with-contact': [
				(options) => {
					assert.deepEqual(options.body, {
						contact_id: CONTACT_ID,
						worker_id: WORKER_ID,
						sector_id: SECTOR_ID,
						official_template: {
							name: 'notifica_usuario',
							language: 'pt_BR',
							variables: [
								{ key: 'BODY {{1}}', component_type: 'BODY', index: 1, value: 'instabilidade' },
								{ key: 'BODY {{2}}', component_type: 'BODY', index: 2, value: 'WhatsApp' },
							],
						},
					});
					return { data: { chat_id: CHAT_ID } };
				},
			],
		};
		const fixture = executionFixture({
			parameters: {
				officialTemplate: { mode: 'list', value: 'notifica_usuario::pt_BR' },
				officialTemplateVariables: {
					mappingMode: 'defineBelow',
					value: {
						[variableFieldId(variables[0])]: 'instabilidade',
						[variableFieldId(variables[1])]: 'WhatsApp',
					},
				},
			},
			routes,
		});

		const result = await executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID);
		assert.deepEqual(result.template, { name: 'notifica_usuario', language: 'pt_BR', sent: true });
		assert.deepEqual(result.official_window, {
			can_send_freeform: false,
			can_send_template: true,
		});
		assert.equal(fixture.requests.some((request) => requestKey(request).endsWith('/official-template')), false);
		fixture.router.assertConsumed();
	});

	test('reutiliza chat ativo e envia o template no endpoint da conversa, sem abrir outro chat', async () => {
		const approved = template({ variables: [] });
		const existingChat = {
			chat_id: CHAT_ID,
			status: 'in_chat',
			contact: { contact_id: CONTACT_ID },
			worker: { worker_id: WORKER_ID },
			sector: { sector_id: SECTOR_ID, name: 'Atendimento' },
		};
		const routes = {
			...baseRoutes({ official: true, chats: [existingChat] }),
			[`GET /chat/${CHAT_ID}/official-conversation/context`]: [officialContext({ templates: [approved] })],
			[`POST /chat/${CHAT_ID}/official-template`]: [
				(options) => {
					assert.deepEqual(options.body, {
						name: 'notifica_usuario',
						language: 'pt_BR',
						variables: [],
					});
					return { data: { ...existingChat, last_message_id: 'message-1' } };
				},
			],
		};
		const fixture = executionFixture({
			parameters: { officialTemplate: { mode: 'list', value: 'notifica_usuario::pt_BR' } },
			routes,
		});

		const result = await executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID);
		assert.equal(result.chat_created, false);
		assert.equal(result.chat_reused, true);
		assert.equal(result.template.sent, true);
		assert.equal(fixture.requests.some((request) => requestKey(request) === 'POST /chat/start-with-contact'), false);
		fixture.router.assertConsumed();
	});

	test('não reutiliza silenciosamente um chat ativo que está em outro setor', async () => {
		const existingChat = {
			chat_id: CHAT_ID,
			status: 'in_chat',
			contact: { contact_id: CONTACT_ID },
			worker: { worker_id: WORKER_ID },
			sector: { sector_id: 'sector-outro', name: 'Financeiro' },
		};
		const fixture = executionFixture({
			routes: baseRoutes({ chats: [existingChat] }),
		});
		await assert.rejects(
			executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
			/outro setor/i,
		);
		assert.equal(fixture.requests.some((request) => request.method === 'POST'), false);
		fixture.router.assertConsumed();
	});

	test('seleciona automaticamente o único template sem variáveis quando a janela o exige', async () => {
		const approved = template({ name: 'boas_vindas', variables: [] });
		const routes = {
			...baseRoutes({ official: true }),
			'GET /chat/official-opening/context': [officialContext({ templates: [approved] })],
			'POST /chat/start-with-contact': [
				(options) => {
					assert.deepEqual(options.body.official_template, {
						name: 'boas_vindas',
						language: 'pt_BR',
						variables: [],
					});
					return { data: { chat_id: CHAT_ID } };
				},
			],
		};
		const fixture = executionFixture({ routes });
		const result = await executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID);
		assert.deepEqual(result.template, { name: 'boas_vindas', language: 'pt_BR', sent: true });
		fixture.router.assertConsumed();
	});

	test('impede template não aprovado, janela bloqueada e template em canal não oficial', async () => {
		const cases = [
			{
				routes: {
					...baseRoutes({ official: true }),
					'GET /chat/official-opening/context': [officialContext({ templates: [] })],
				},
				parameters: { officialTemplate: { mode: 'id', value: 'inexistente::pt_BR' } },
				message: /não está aprovado/i,
			},
			{
				routes: {
					...baseRoutes({ official: true }),
					'GET /chat/official-opening/context': [
						officialContext({ canSendTemplate: false, templates: [template()] }),
					],
				},
				parameters: { officialTemplate: { mode: 'id', value: 'notifica_usuario::pt_BR' } },
				message: /não permite enviar template/i,
			},
			{
				routes: baseRoutes({ official: false }),
				parameters: { officialTemplate: { mode: 'id', value: 'notifica_usuario::pt_BR' } },
				message: /canal não oficial/i,
			},
		];
		for (const scenario of cases) {
			const fixture = executionFixture(scenario);
			await assert.rejects(
				executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
				scenario.message,
			);
			assert.equal(fixture.requests.some((request) => requestKey(request) === 'POST /chat/start-with-contact'), false);
			fixture.router.assertConsumed();
		}
	});

	test('recusa variável ausente e JSON que não corresponde ao schema aprovado', async () => {
		const variable = bodyVariable(1, 'problema');
		for (const [parameters, message] of [
			[
				{
					officialTemplate: { mode: 'list', value: 'notifica_usuario::pt_BR' },
					officialTemplateVariables: { mappingMode: 'defineBelow', value: {} },
				},
				/Preencha a variável/i,
			],
			[
				{
					officialTemplate: { mode: 'list', value: 'notifica_usuario::pt_BR' },
					templateVariableInputMode: 'json',
					officialTemplateVariablesJson: JSON.stringify([
						{ key: 'BODY {{2}}', component_type: 'BODY', index: 2, value: 'errado' },
					]),
				},
				/Preencha a variável/i,
			],
		]) {
			const fixture = executionFixture({
				parameters,
				routes: {
					...baseRoutes({ official: true }),
					'GET /chat/official-opening/context': [
						officialContext({ templates: [template({ variables: [variable] })] }),
					],
				},
			});
			await assert.rejects(
				executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
				message,
			);
			assert.equal(fixture.requests.some((request) => requestKey(request) === 'POST /chat/start-with-contact'), false);
			fixture.router.assertConsumed();
		}
	});

	test('recusa ambiguidade quando existem dois chats ativos do mesmo contato e canal', async () => {
		const active = (id) => ({
			chat_id: id,
			contact: { contact_id: CONTACT_ID },
			worker: { worker_id: WORKER_ID },
		});
		const fixture = executionFixture({
			routes: baseRoutes({ chats: [active('chat-a'), active('chat-b')] }),
		});
		await assert.rejects(
			executeStartChatByPhone.call(fixture.context, 0, EXECUTOR_ID),
			/mais de um atendimento ativo/i,
		);
		fixture.router.assertConsumed();
	});
});

describe('startChatByPhone — interface dinâmica do n8n', { concurrency: false }, () => {
	test('lista somente templates aprovados e permite filtrar por nome/idioma/prévia', async () => {
		const approved = template({ variables: [bodyVariable(1, 'problema')] });
		const ignored = template({ name: 'rascunho', status: 'PENDING' });
		const routes = {
			'GET /chat/workers': [{ data: [worker(true)] }],
			'GET /chat/sectors': [{ data: [sector()] }],
			'GET /chat/contacts/by-phone': [{ data: contact() }],
			'GET /chat/official-opening/context': [
				officialContext({ templates: [approved, ignored] }),
			],
		};
		const fixture = loadOptionsFixture({ routes });
		const result = await searchOfficialTemplates.call(fixture.context, 'notifica');
		assert.equal(result.results.length, 1);
		assert.equal(result.results[0].value, 'notifica_usuario::pt_BR');
		assert.match(result.results[0].name, /notifica_usuario/);
		assert.match(result.results[0].name, /pt_BR/);
		assert.match(result.results[0].name, /1 vari/);
		fixture.router.assertConsumed();
	});

	test('gera um campo obrigatório por variável usando o schema vivo do template', async () => {
		const variables = [
			bodyVariable(1, 'problema'),
			bodyVariable(2, 'produto', { parameter_name: 'produto' }),
		];
		const routes = {
			'GET /chat/workers': [{ data: [worker(true)] }],
			'GET /chat/sectors': [{ data: [sector()] }],
			'GET /chat/contacts/by-phone': [{ data: contact() }],
			'GET /chat/official-opening/context': [
				officialContext({ templates: [template({ variables })] }),
			],
		};
		const fixture = loadOptionsFixture({ routes });
		const result = await getOfficialTemplateVariables.call(fixture.context);
		assert.deepEqual(result.fields.map((field) => ({
			id: field.id,
			required: field.required,
			display: field.display,
			type: field.type,
		})), variables.map((variable) => ({
			id: variableFieldId(variable),
			required: true,
			display: true,
			type: 'string',
		})));
		assert.match(result.fields[0].displayName, /BODY/);
		assert.match(result.fields[0].displayName, /problema/);
		fixture.router.assertConsumed();
	});

	test('usa contato de referência para listar templates sem cadastrar o telefone dinâmico ou ausente', async () => {
		const catalogRoutes = () => ({
			'GET /chat/workers': [{ data: [worker(true)] }],
			'GET /chat/sectors': [{ data: [sector()] }],
			'GET /chat/contacts': [{ data: { results: [contact()] } }],
			'GET /chat/official-opening/context': [
				officialContext({ templates: [template()] }),
			],
		});
		const expressionFixture = loadOptionsFixture({
			parameters: { phone: '={{ $json.telefone }}' },
			routes: catalogRoutes(),
		});
		assert.equal((await searchOfficialTemplates.call(expressionFixture.context)).results.length, 1);
		assert.equal(expressionFixture.requests.some((request) => request.method === 'POST'), false);
		assert.deepEqual(
			expressionFixture.requests.find((request) => requestKey(request) === 'GET /chat/contacts').qs,
			{ current_page: 1, per_page: 1, filter_channel_id: WORKER_ID },
		);
		expressionFixture.router.assertConsumed();

		const missingFixture = loadOptionsFixture({
			routes: {
				...catalogRoutes(),
				'GET /chat/contacts/by-phone': [notFound()],
			},
		});
		assert.equal((await searchOfficialTemplates.call(missingFixture.context)).results.length, 1);
		assert.equal(missingFixture.requests.some((request) => request.method === 'POST'), false);
		missingFixture.router.assertConsumed();
	});

	test('descrição registra resourceLocator e resourceMapper com todas as dependências', () => {
		const description = new UnderChat().description;
		const byName = (name) => description.properties.filter((property) => property.name === name);
		const templateProperty = byName('officialTemplate')[0];
		const mapper = byName('officialTemplateVariables')[0];
		assert.equal(templateProperty.type, 'resourceLocator');
		assert.equal(templateProperty.modes[0].typeOptions.searchListMethod, 'searchOfficialTemplates');
		assert.deepEqual(templateProperty.typeOptions.loadOptionsDependsOn, [
			'executorId.value',
			'workerId.value',
			'sectorId.value',
			'phoneDdi',
			'phone',
		]);
		assert.equal(mapper.type, 'resourceMapper');
		assert.equal(mapper.typeOptions.resourceMapper.resourceMapperMethod, 'getOfficialTemplateVariables');
		assert.equal(mapper.typeOptions.resourceMapper.mode, 'map');
		assert.equal(mapper.typeOptions.resourceMapper.supportAutoMap, false);
		assert.equal(typeof new UnderChat().methods.listSearch.searchOfficialTemplates, 'function');
		assert.equal(typeof new UnderChat().methods.resourceMapping.getOfficialTemplateVariables, 'function');
	});
});
