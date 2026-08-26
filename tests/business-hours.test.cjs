'use strict';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { Expression, NodeHelpers, NodeOperationError } = require('n8n-workflow');
const {
	parseBusinessHoursRules,
	isWithinBusinessHours,
} = require('../dist/nodes/UnderChat/BusinessHours.js');
const { UnderChat } = require('../dist/nodes/UnderChat/UnderChat.node.js');

const MONDAY = '2026-08-24';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const range = (days, startTime = '08:00', endTime = '17:59') => ({
	days,
	startTime,
	endTime,
});
const parse = (...rules) => parseBusinessHoursRules({ rules });
const at = (date, time) => new Date(`${date}T${time}Z`);
const onMonday = (time, rules, zone = 'UTC') =>
	isWithinBusinessHours(at(MONDAY, time), zone, rules);

function businessContext({
	items = [{ json: {} }],
	parameters = {},
	itemParameters = [],
	workflowTimezone = 'UTC',
	nodeType = 'n8n-nodes-underchat.underChat',
	continueOnFail = false,
	onParameter,
} = {}) {
	const values = {
		resource: 'businessHours',
		operation: 'checkBusinessHours',
		businessHoursRules: { rules: [{ days: ALL_DAYS, allDay: true }] },
		...parameters,
	};
	const calls = { credentials: 0, api: 0, executor: 0, timezone: 0 };
	const node = {
		id: 'business-hours-test',
		name: 'Horário de funcionamento',
		type: nodeType,
		typeVersion: 1,
		position: [0, 0],
		parameters: values,
	};
	const forbiddenApi = () => {
		calls.api++;
		throw new Error('Horário de funcionamento não pode chamar a API');
	};
	const context = {
		getNode: () => node,
		getInputData: () => items,
		getNodeParameter(name, itemIndex, fallback) {
			if (name === 'executorId') {
				calls.executor++;
				throw new Error('Horário de funcionamento não pode consultar o executor');
			}
			onParameter?.(name, itemIndex);
			const overrides = itemParameters[itemIndex] ?? {};
			if (Object.hasOwn(overrides, name)) return overrides[name];
			return Object.hasOwn(values, name) ? values[name] : fallback;
		},
		async getCredentials() {
			calls.credentials++;
			throw new Error('Horário de funcionamento não pode consultar credenciais');
		},
		getTimezone() {
			calls.timezone++;
			return workflowTimezone;
		},
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: forbiddenApi,
			httpRequestWithAuthentication: forbiddenApi,
			request: forbiddenApi,
			requestWithAuthentication: forbiddenApi,
		},
	};
	return { context, calls, items };
}

function assertOffline(calls) {
	assert.equal(calls.credentials, 0, 'nenhuma credencial deve ser consultada');
	assert.equal(calls.executor, 0, 'nenhum executor deve ser consultado');
	assert.equal(calls.api, 0, 'nenhuma API deve ser chamada');
}

async function withClock(t, iso, action) {
	t.mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });
	try {
		return await action();
	} finally {
		t.mock.timers.reset();
	}
}

describe('parseBusinessHoursRules', () => {
	test('normaliza dias numéricos/textuais, remove duplicatas e aceita horas com espaços', () => {
		const input = { rules: [range([1, '2', 1, '7'], ' 8:00 ', ' 23:59 ')] };
		const before = structuredClone(input);
		assert.deepEqual(parseBusinessHoursRules(input), [
			{ days: [1, 2, 7], startMinute: 480, endMinute: 1439 },
		]);
		assert.deepEqual(input, before, 'a configuração original deve permanecer intacta');
	});

	test('rejeita configurações ausentes, coleções inválidas e nenhuma faixa', () => {
		for (const input of [undefined, null, '', [], {}, { rules: null }, { rules: {} }, { rules: [] }]) {
			assert.throws(() => parseBusinessHoursRules(input), /pelo menos uma faixa/);
		}
	});

	test('rejeita faixas sem uma lista não vazia de dias', () => {
		for (const rule of [null, [], {}, range(undefined), range(null), range('1'), range([])]) {
			assert.throws(() => parse(rule), /Faixa 1: selecione pelo menos um dia/);
		}
	});

	test('rejeita dias fora de 1–7, formatos ambíguos e valores não escalares', () => {
		for (const day of [0, 8, -1, 1.5, NaN, Infinity, '01', '1 ', 'Mon', '', true, null, {}, []]) {
			assert.throws(() => parse(range([day])), /Faixa 1: dia da semana inválido/);
		}
	});

	test('valida início e fim e identifica o número da faixa incorreta', () => {
		const invalidTimes = [undefined, null, 800, '', '24:00', '23:60', '08:0', '8', '-01:00', '08:00:00'];
		for (const field of ['startTime', 'endTime']) {
			for (const time of invalidTimes) {
				const invalid = { ...range([1]), [field]: time };
				assert.throws(() => parse(range([2]), invalid), /Faixa 2:.*(?:HH:mm|inválido)/);
			}
		}
	});

	test('Dia Inteiro ignora horas ocultas, mas exige dias e booleano válido', () => {
		assert.deepEqual(parse({ days: [6, 7], allDay: true, startTime: 'inválido', endTime: null }), [
			{ days: [6, 7], startMinute: 0, endMinute: 1439 },
		]);
		assert.deepEqual(parse({ days: [1], allDay: true }), [
			{ days: [1], startMinute: 0, endMinute: 1439 },
		]);
		for (const allDay of ['true', 'false', 1, 0, null]) {
			assert.throws(() => parse({ ...range([1]), allDay }), /Dia Inteiro/);
		}
		assert.throws(() => parse({ days: [], allDay: true }), /dia da semana/);
		assert.throws(() => parse({ days: [1], allDay: false }), /HH:mm/);
	});
});

describe('isWithinBusinessHours', () => {
	test('respeita cada um dos sete dias da semana', () => {
		for (let weekday = 1; weekday <= 7; weekday++) {
			const rules = parse(range([weekday], '08:00', '08:00'));
			for (let day = 0; day < 7; day++) {
				const date = new Date(Date.UTC(2026, 7, 24 + day, 8));
				assert.equal(isWithinBusinessHours(date, 'UTC', rules), weekday === day + 1);
			}
		}
	});

	test('inclui o minuto final inteiro, sem incluir o minuto seguinte', () => {
		const rules = parse(range([1], '08:00', '12:00'));
		for (const [time, expected] of [
			['07:59:59.999', false], ['08:00:00.000', true],
			['12:00:00.000', true], ['12:00:59.999', true], ['12:01:00.000', false],
		]) {
			assert.equal(onMonday(time, rules), expected, time);
		}
	});

	test('início igual ao fim significa exatamente um minuto, não um dia inteiro', () => {
		const rules = parse(range([1], '12:00', '12:00'));
		for (const [time, expected] of [
			['00:00:00.000', false], ['11:59:59.999', false],
			['12:00:00.000', true], ['12:00:59.999', true], ['12:01:00.000', false],
		]) {
			assert.equal(onMonday(time, rules), expected, time);
		}
	});

	test('Dia Inteiro inclui meia-noite e 23:59:59.999 somente nos dias selecionados', () => {
		const rules = parse({ days: [6, 7], allDay: true });
		for (const [iso, expected] of [
			['2026-08-28T23:59:59.999Z', false], ['2026-08-29T00:00:00.000Z', true],
			['2026-08-29T12:00:00.000Z', true], ['2026-08-30T23:59:59.999Z', true],
			['2026-08-31T00:00:00.000Z', false],
		]) {
			assert.equal(isWithinBusinessHours(new Date(iso), 'UTC', rules), expected, iso);
		}
	});

	test('combina múltiplas faixas como união, preserva intervalos e tolera sobreposição', () => {
		const rules = parse(
			range([1], '08:00', '09:00'),
			range([1], '08:30', '10:00'),
			range([1], '13:00', '14:00'),
		);
		for (const [time, expected] of [
			['07:59:59.999', false], ['08:00:00.000', true], ['08:45:00.000', true],
			['10:00:59.999', true], ['10:01:00.000', false], ['12:59:59.999', false],
			['13:00:00.000', true], ['14:00:59.999', true], ['14:01:00.000', false],
		]) {
			assert.equal(onMonday(time, rules), expected, time);
		}
	});

	test('faixa 22:00–02:00 pertence ao dia inicial e atravessa domingo para segunda', () => {
		const rules = parse(range([7], '22:00', '02:00'));
		for (const [iso, expected] of [
			['2026-08-30T01:00:00.000Z', false], ['2026-08-30T21:59:59.999Z', false],
			['2026-08-30T22:00:00.000Z', true], ['2026-08-30T23:59:59.999Z', true],
			['2026-08-31T00:00:00.000Z', true], ['2026-08-31T02:00:59.999Z', true],
			['2026-08-31T02:01:00.000Z', false], ['2026-08-31T22:00:00.000Z', false],
		]) {
			assert.equal(isWithinBusinessHours(new Date(iso), 'UTC', rules), expected, iso);
		}
	});

	test('madrugadas de dias consecutivos não criam uma faixa contínua de 24 horas', () => {
		const rules = parse(range([5, 6], '22:00', '02:00'));
		for (const [iso, expected] of [
			['2026-08-29T01:00:00Z', true], ['2026-08-29T12:00:00Z', false],
			['2026-08-29T22:00:00Z', true], ['2026-08-30T02:00:59.999Z', true],
			['2026-08-30T02:01:00Z', false], ['2026-08-30T22:00:00Z', false],
		]) {
			assert.equal(isWithinBusinessHours(new Date(iso), 'UTC', rules), expected, iso);
		}
	});

	test('usa o fuso configurado para hora e dia, independentemente do UTC da data', () => {
		const rules = parse(range([1], '08:00', '11:00'));
		const instant = new Date('2026-08-24T10:59:59Z');
		assert.equal(isWithinBusinessHours(instant, 'UTC', rules), true);
		assert.equal(isWithinBusinessHours(instant, 'America/Sao_Paulo', rules), false);
		assert.equal(isWithinBusinessHours(new Date('2026-08-24T11:00:00Z'), ' America/Sao_Paulo ', rules), true);
		const sunday = parse({ days: [7], allDay: true });
		assert.equal(isWithinBusinessHours(new Date('2026-08-24T02:30:00Z'), 'UTC', sunday), false);
		assert.equal(isWithinBusinessHours(new Date('2026-08-24T02:30:00Z'), 'America/Sao_Paulo', sunday), true);
	});

	test('respeita a hora inexistente na entrada do DST IANA de Nova York', () => {
		const rules = parse(range([7], '01:30', '02:30'));
		assert.equal(isWithinBusinessHours(new Date('2026-03-08T06:59:59.999Z'), 'America/New_York', rules), true);
		assert.equal(isWithinBusinessHours(new Date('2026-03-08T07:00:00.000Z'), 'America/New_York', rules), false);
		const missingHour = parse(range([7], '02:00', '02:59'));
		const begin = Date.parse('2026-03-08T05:00:00Z');
		for (let minute = 0; minute < 240; minute++) {
			assert.equal(isWithinBusinessHours(new Date(begin + minute * 60_000), 'America/New_York', missingHour), false);
		}
	});

	test('inclui as duas ocorrências de uma hora repetida na saída do DST IANA', () => {
		const rules = parse(range([7], '01:00', '01:59'));
		for (const [iso, expected] of [
			['2026-11-01T04:59:59.999Z', false], ['2026-11-01T05:00:00.000Z', true],
			['2026-11-01T05:59:59.999Z', true], ['2026-11-01T06:00:00.000Z', true],
			['2026-11-01T06:59:59.999Z', true], ['2026-11-01T07:00:00.000Z', false],
		]) {
			assert.equal(isWithinBusinessHours(new Date(iso), 'America/New_York', rules), expected, iso);
		}
	});

	test('rejeita data e fuso inválidos, sem confundi-los com Fora do horário', () => {
		const rules = parse({ days: ALL_DAYS, allDay: true });
		for (const date of [new Date(NaN), '2026-08-24', 0, null, undefined, {}]) {
			assert.throws(() => isWithinBusinessHours(date, 'UTC', rules), /data e hora/);
		}
		for (const zone of ['', '   ', null, undefined, 42, 'Invalid/Timezone']) {
			assert.throws(() => isWithinBusinessHours(at(MONDAY, '08:00:00'), zone, rules), /[Ff]uso/);
		}
		assert.equal(isWithinBusinessHours(at(MONDAY, '08:00:00'), 'UTC', []), false);
	});

	test('reproduz a agenda do usuário nos 10.080 minutos contra uma tabela independente', { timeout: 120_000 }, () => {
		const rules = parse(
			range([1, 2, 3, 4, 5], '00:00', '07:59'),
			range([1, 2, 3, 4, 5], '12:01', '12:59'),
			range([1, 2, 3, 4], '18:00', '23:59'),
			range([5], '17:00', '23:59'),
			{ days: [6, 7], allDay: true },
		);
		// Oráculo declarativo separado do algoritmo, dos minutos compilados e do Intl.
		const expectedRanges = [
			[['00:00', '07:59'], ['12:01', '12:59'], ['18:00', '23:59']],
			[['00:00', '07:59'], ['12:01', '12:59'], ['18:00', '23:59']],
			[['00:00', '07:59'], ['12:01', '12:59'], ['18:00', '23:59']],
			[['00:00', '07:59'], ['12:01', '12:59'], ['18:00', '23:59']],
			[['00:00', '07:59'], ['12:01', '12:59'], ['17:00', '23:59']],
			[['00:00', '23:59']],
			[['00:00', '23:59']],
		];
		const beginning = Date.parse('2026-08-24T00:00:00-03:00');
		const dailyCounts = [];
		for (let day = 0; day < 7; day++) {
			let matched = 0;
			for (let minute = 0; minute < 1440; minute++) {
				const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
				const expected = expectedRanges[day].some(([start, end]) => clock >= start && clock <= end);
				const actual = isWithinBusinessHours(new Date(beginning + (day * 1440 + minute) * 60_000), 'America/Sao_Paulo', rules);
				assert.equal(actual, expected, `dia ${day + 1}, ${clock}`);
				if (actual) matched++;
			}
			dailyCounts.push(matched);
		}
		assert.deepEqual(dailyCounts, [899, 899, 899, 899, 959, 1440, 1440]);
		assert.equal(dailyCounts.reduce((sum, value) => sum + value, 0), 7435);
	});
});

describe('UnderChat.execute — recurso businessHours', { concurrency: false }, () => {
	test('separa em duas saídas, preserva json/binary e vincula o índice original de cada item', async (t) => {
		await withClock(t, '2026-08-24T08:30:00Z', async () => {
			const binary = Object.freeze({ attachment: Object.freeze({ data: 'AA==', mimeType: 'application/octet-stream', fileName: 'audit.bin' }) });
			const items = [
				Object.freeze({ json: Object.freeze({ id: 'inside-0', nested: { original: true } }), binary, pairedItem: Object.freeze({ item: 99 }) }),
				Object.freeze({ json: Object.freeze({ id: 'outside-1', empty: null }), binary }),
				Object.freeze({ json: Object.freeze({ id: 'inside-2', list: [1, 2] }) }),
			];
			const fixture = businessContext({
				items,
				parameters: { businessHoursTimezone: 'UTC' },
				itemParameters: [
					{ businessHoursRules: { rules: [range([1], '08:00', '09:00')] } },
					{ businessHoursRules: { rules: [range([2], '08:00', '09:00')] } },
					{ businessHoursRules: { rules: [range([1], '08:00', '09:00'), range([1], '08:15', '10:00')] } },
				],
			});
			const outputs = await UnderChat.prototype.execute.call(fixture.context);
			assert.deepEqual(outputs, [
				[{ ...items[0], pairedItem: { item: 0 } }, { ...items[2], pairedItem: { item: 2 } }],
				[{ ...items[1], pairedItem: { item: 1 } }],
			]);
			assert.equal(outputs.flat().length, items.length, 'sobreposição não duplica itens');
			for (const output of outputs.flat()) {
				const original = items[output.pairedItem.item];
				assert.notEqual(output, original);
				assert.equal(output.json, original.json);
				assert.equal(output.binary, original.binary);
			}
			assert.deepEqual(items[0].pairedItem, { item: 99 });
			assert.equal(Object.hasOwn(items[1], 'pairedItem'), false);
			assertOffline(fixture.calls);
		});
	});

	test('captura uma única data para todos os itens, mesmo atravessando a fronteira durante a execução', async (t) => {
		await withClock(t, '2026-08-24T07:59:59.500Z', async () => {
			const rawRules = { rules: [range([1], '07:59', '07:59')] };
			let clockAdvanced = false;
			const fixture = businessContext({
				items: [{ json: { id: 0 } }, { json: { id: 1 } }],
				parameters: { businessHoursTimezone: 'UTC', businessHoursRules: rawRules },
				onParameter(name, index) {
					if (name === 'businessHoursRules' && index === 1) {
						t.mock.timers.tick(2000);
						clockAdvanced = true;
					}
				},
			});
			const outputs = await UnderChat.prototype.execute.call(fixture.context);
			assert.equal(clockAdvanced, true);
			assert.equal(outputs[0].length, 2);
			assert.equal(outputs[1].length, 0);
			assert.equal(isWithinBusinessHours(new Date(), 'UTC', parseBusinessHoursRules(rawRules)), false);
			assertOffline(fixture.calls);
		});
	});

	test('aceita UTC, fuso padrão, fuso do workflow e personalizado por item', async (t) => {
		await withClock(t, '2026-08-24T10:30:00Z', async () => {
			const fixture = businessContext({
				items: [0, 1, 2, 3].map((id) => ({ json: { id } })),
				parameters: { businessHoursRules: { rules: [range([1], '08:00', '11:00')] } },
				workflowTimezone: 'America/Sao_Paulo',
				itemParameters: [
					{ businessHoursTimezone: 'UTC' },
					{},
					{ businessHoursTimezone: 'workflow' },
					{ businessHoursTimezone: 'custom', businessHoursCustomTimezone: 'UTC' },
				],
			});
			const outputs = await UnderChat.prototype.execute.call(fixture.context);
			assert.deepEqual(outputs.map((branch) => branch.map((item) => item.json.id)), [[0, 3], [1, 2]]);
			assert.equal(fixture.calls.timezone, 1);
			assertOffline(fixture.calls);
		});
	});

	test('zero itens retorna exatamente duas saídas vazias e não fabrica dados', async () => {
		const fixture = businessContext({ items: [] });
		assert.deepEqual(await UnderChat.prototype.execute.call(fixture.context), [[], []]);
		assertOffline(fixture.calls);
	});

	test('configuração inválida sempre lança NodeOperationError, inclusive com continueOnFail', async (t) => {
		await withClock(t, '2026-08-24T08:00:00Z', async () => {
			for (const invalid of [
				{ businessHoursRules: {} },
				{ businessHoursRules: { rules: [range([], '08:00', '17:59')] } },
				{ businessHoursRules: { rules: [range([1], '24:00', '17:59')] } },
				{ businessHoursTimezone: 'Invalid/Timezone' },
				{ businessHoursTimezone: 'custom', businessHoursCustomTimezone: '' },
				{ businessHoursTimezone: 'workflow' },
			]) {
				const fixture = businessContext({
					items: [{ json: { valid: true } }, { json: { invalid: true } }],
					parameters: { businessHoursTimezone: 'UTC' },
					itemParameters: [{}, invalid],
					workflowTimezone: 'Invalid/Timezone',
					continueOnFail: true,
				});
				await assert.rejects(UnderChat.prototype.execute.call(fixture.context), (error) => {
					assert.ok(error instanceof NodeOperationError);
					assert.equal(error.context.itemIndex, 1);
					return true;
				});
				assertOffline(fixture.calls);
			}
		});
	});

	test('recusa uma operação diferente antes de qualquer chamada autenticada', async () => {
		const fixture = businessContext({ parameters: { operation: 'sendText' }, continueOnFail: true });
		await assert.rejects(UnderChat.prototype.execute.call(fixture.context), (error) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /Verificar Horário/);
			return true;
		});
		assertOffline(fixture.calls);
	});

	test('recusa a variante Tool, mesmo com configuração válida e continueOnFail', async () => {
		const fixture = businessContext({ nodeType: 'n8n-nodes-underchat.underChatTool', continueOnFail: true });
		await assert.rejects(UnderChat.prototype.execute.call(fixture.context), (error) => {
			assert.ok(error instanceof NodeOperationError);
			assert.match(error.message, /não como ferramenta de IA/);
			return true;
		});
		assertOffline(fixture.calls);
	});
});

describe('descrição do node e compatibilidade legada', () => {
	const description = new UnderChat().description;
	const normalNode = { typeVersion: 1 };
	const property = (name) => {
		const found = description.properties.find((entry) => entry.name === name);
		assert.ok(found, `propriedade ${name} deve existir`);
		return found;
	};
	const visible = (parameter, values, typeDescription = description) =>
		NodeHelpers.displayParameter(values, parameter, normalNode, typeDescription);

	test('resolve duas saídas nomeadas somente no recurso businessHours', () => {
		const expression = new Expression('America/Sao_Paulo');
		const outputs = (parameters) =>
			expression.resolveSimpleParameterValue(description.outputs, { $parameter: parameters });
		assert.deepEqual(outputs({ resource: 'businessHours' }), [
			{ type: 'main', displayName: 'Dentro do horário' },
			{ type: 'main', displayName: 'Fora do horário' },
		]);
		for (const parameters of [{}, ...['message', 'contact', 'chat', 'directory'].map((resource) => ({ resource }))]) {
			assert.deepEqual(outputs(parameters), ['main']);
		}
	});

	test('NodeHelpers real esconde credenciais e executor apenas nos cenários corretos', () => {
		const credential = description.credentials.find((entry) => entry.name === 'underChatApi');
		assert.ok(credential);
		assert.equal(credential.required, true);
		assert.equal(visible(credential, { resource: 'businessHours', operation: 'checkBusinessHours' }), false);
		assert.equal(visible(property('executorId'), { resource: 'businessHours', operation: 'checkBusinessHours' }), false);
		for (const parameters of [
			{ resource: 'message', operation: 'sendText' },
			{ resource: 'contact', operation: 'createContact' },
			{ resource: 'chat', operation: 'transferChat' },
			{ resource: 'directory', operation: 'listUsers' },
			{ operation: 'sendText' },
		]) {
			assert.equal(visible(credential, parameters), true);
			assert.equal(visible(property('executorId'), parameters), true);
		}
		assert.equal(visible(credential, { resource: 'directory', operation: 'listExecutors' }), true);
		assert.equal(visible(property('executorId'), { resource: 'directory', operation: 'listExecutors' }), false);
	});

	test('NodeHelpers aplica os defaults de agenda sem expor os campos legados', () => {
		const parameters = NodeHelpers.getNodeParameters(
			description.properties,
			{ resource: 'businessHours' },
			true,
			false,
			normalNode,
			description,
		);
		assert.equal(parameters.operation, 'checkBusinessHours');
		assert.equal(parameters.businessHoursTimezone, 'America/Sao_Paulo');
		assert.deepEqual(parameters.businessHoursRules, {});
		for (const hidden of ['executorId', 'chatId', 'message', 'phone', 'templateName']) {
			assert.equal(Object.hasOwn(parameters, hidden), false, hidden);
		}
	});

	test('coleção permite múltiplas faixas, dias 1–7 e oculta horas quando Dia Inteiro está ativo', () => {
		const rulesProperty = property('businessHoursRules');
		assert.equal(rulesProperty.type, 'fixedCollection');
		assert.equal(rulesProperty.typeOptions.multipleValues, true);
		const fields = rulesProperty.options.find((option) => option.name === 'rules').values;
		const field = (name) => fields.find((entry) => entry.name === name);
		assert.deepEqual(field('days').options.map((option) => option.value), ALL_DAYS);
		for (const name of ['startTime', 'endTime']) {
			assert.equal(visible(field(name), { allDay: true }), false);
			assert.equal(visible(field(name), { allDay: false }), true);
		}
		assert.equal(visible(property('businessHoursCustomTimezone'), { resource: 'businessHours', businessHoursTimezone: 'custom' }), true);
		assert.equal(visible(property('businessHoursCustomTimezone'), { resource: 'businessHours', businessHoursTimezone: 'UTC' }), false);
		assert.equal(visible(rulesProperty, { resource: 'message' }), false);
	});

	test('recurso de agenda fica oculto na variante Tool sem retirar os recursos existentes', () => {
		const resource = property('resource');
		const option = resource.options.find((entry) => entry.value === 'businessHours');
		assert.ok(option);
		const toolDescription = { ...description, name: `${description.name}Tool` };
		assert.equal(visible(option, {}, description), true);
		assert.equal(visible(option, {}, toolDescription), false);
		for (const existing of resource.options.filter((entry) => entry.value !== 'businessHours')) {
			assert.equal(visible(existing, {}, toolDescription), true);
		}
	});

	test('listExecutors mantém autenticação e uma saída, inclusive em node legado sem resource', async () => {
		for (const includeResource of [true, false]) {
			const credentialsRead = [];
			const requests = [];
			const parameters = { operation: 'listExecutors', ...(includeResource ? { resource: 'directory' } : {}) };
			const returned = [{ user_id: 'executor-de-teste', name: 'Executor fictício' }];
			const context = {
				getNode: () => ({ id: 'legacy-test', name: 'UnderChat', type: 'n8n-nodes-underchat.underChat', typeVersion: 1, position: [0, 0], parameters }),
				getInputData: () => [{ json: { unchanged: true } }],
				getNodeParameter: (name, _index, fallback) => Object.hasOwn(parameters, name) ? parameters[name] : fallback,
				async getCredentials(name) {
					credentialsRead.push(name);
					return { baseUrl: 'https://underchat.invalid/v1/', apiKey: 'ficticia-sem-acesso' };
				},
				continueOnFail: () => false,
				helpers: {
					async httpRequestWithAuthentication(name, options) {
						assert.equal(this, context);
						requests.push({ name, options });
						return { data: returned };
					},
				},
			};
			assert.deepEqual(await UnderChat.prototype.execute.call(context), [
				[{ json: { results: returned }, pairedItem: 0 }],
			]);
			assert.ok(credentialsRead.length > 0);
			assert.ok(credentialsRead.every((name) => name === 'underChatApi'));
			assert.deepEqual(requests, [{
				name: 'underChatApi',
				options: { method: 'GET', url: 'https://underchat.invalid/v1/user/all', json: true },
			}]);
		}
	});
});
