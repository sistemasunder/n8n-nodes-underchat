import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export interface BusinessHoursRule {
	days: number[];
	startMinute: number;
	endMinute: number;
}

const weekdayNumbers: Record<string, number> = {
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
	Sun: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTime(value: unknown, field: string, ruleNumber: number): number {
	if (typeof value !== 'string') {
		throw new Error(`Faixa ${ruleNumber}: informe ${field} no formato HH:mm`);
	}
	const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
	if (!match) {
		throw new Error(
			`Faixa ${ruleNumber}: ${field} inválido. Use HH:mm, de 00:00 a 23:59`,
		);
	}
	return Number(match[1]) * 60 + Number(match[2]);
}

export function parseBusinessHoursRules(value: unknown): BusinessHoursRule[] {
	if (
		!isRecord(value) ||
		!Array.isArray(value.rules) ||
		value.rules.length === 0
	) {
		throw new Error(
			'Adicione pelo menos uma faixa de horário e selecione os dias da semana',
		);
	}

	return value.rules.map((rule: unknown, index: number) => {
		const ruleNumber = index + 1;
		if (
			!isRecord(rule) ||
			!Array.isArray(rule.days) ||
			rule.days.length === 0
		) {
			throw new Error(
				`Faixa ${ruleNumber}: selecione pelo menos um dia da semana`,
			);
		}
		const days = rule.days.map((day: unknown) => {
			if (
				(typeof day !== 'number' && typeof day !== 'string') ||
				!/^[1-7]$/.test(String(day))
			) {
				throw new Error(`Faixa ${ruleNumber}: dia da semana inválido`);
			}
			return Number(day);
		});
		if (rule.allDay !== undefined && typeof rule.allDay !== 'boolean') {
			throw new Error(
				`Faixa ${ruleNumber}: Dia Inteiro deve estar ativado ou desativado`,
			);
		}
		return {
			days: [...new Set(days)],
			startMinute:
				rule.allDay === true
					? 0
					: parseTime(rule.startTime, 'o início', ruleNumber),
			endMinute:
				rule.allDay === true
					? 1439
					: parseTime(rule.endTime, 'o fim', ruleNumber),
		};
	});
}

export function isWithinBusinessHours(
	date: Date,
	timeZone: string,
	rules: BusinessHoursRule[],
): boolean {
	if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
		throw new Error('Não foi possível determinar a data e hora da verificação');
	}
	if (typeof timeZone !== 'string' || timeZone.trim() === '') {
		throw new Error('Informe um fuso horário válido, como America/Sao_Paulo');
	}

	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: timeZone.trim(),
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
		});
	} catch {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- Helper puro: executeBusinessHours converte a falha em NodeOperationError com o índice do item.
		throw new Error(
			`Fuso horário inválido: ${timeZone}. Use um nome IANA, como America/Sao_Paulo`,
		);
	}
	const parts = formatter.formatToParts(date);
	const weekday =
		weekdayNumbers[parts.find((part) => part.type === 'weekday')?.value ?? ''];
	const hour = Number(parts.find((part) => part.type === 'hour')?.value);
	const minute = Number(parts.find((part) => part.type === 'minute')?.value);
	if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) {
		throw new Error(
			'Não foi possível interpretar o horário no fuso selecionado',
		);
	}
	const minuteOfDay = hour * 60 + minute;
	const previousWeekday = weekday === 1 ? 7 : weekday - 1;

	return rules.some((rule) => {
		if (rule.startMinute <= rule.endMinute) {
			return (
				rule.days.includes(weekday) &&
				minuteOfDay >= rule.startMinute &&
				minuteOfDay <= rule.endMinute
			);
		}
		// A faixa pertence ao dia em que começa e pode terminar no dia seguinte.
		return (
			(rule.days.includes(weekday) && minuteOfDay >= rule.startMinute) ||
			(rule.days.includes(previousWeekday) && minuteOfDay <= rule.endMinute)
		);
	});
}

export async function executeBusinessHours(
	this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
	if (this.getNode().type.endsWith('Tool')) {
		throw new NodeOperationError(
			this.getNode(),
			'Use Horário de Funcionamento no node UnderChat normal, não como ferramenta de IA',
		);
	}
	if (
		this.getNodeParameter('operation', 0, 'checkBusinessHours') !==
		'checkBusinessHours'
	) {
		throw new NodeOperationError(
			this.getNode(),
			'Selecione a operação Verificar Horário',
		);
	}
	const items = this.getInputData();
	const outputs: INodeExecutionData[][] = [[], []];
	const now = new Date();

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		try {
			const selectedTimeZone = this.getNodeParameter(
				'businessHoursTimezone',
				itemIndex,
				'America/Sao_Paulo',
			) as string;
			const timeZone =
				selectedTimeZone === 'workflow'
					? this.getTimezone()
					: selectedTimeZone === 'custom'
						? (this.getNodeParameter(
								'businessHoursCustomTimezone',
								itemIndex,
								'',
							) as string)
						: selectedTimeZone;
			const rules = parseBusinessHoursRules(
				this.getNodeParameter('businessHoursRules', itemIndex, {}),
			);
			const outputIndex = isWithinBusinessHours(now, timeZone, rules) ? 0 : 1;
			outputs[outputIndex].push({
				...items[itemIndex],
				pairedItem: { item: itemIndex },
			});
		} catch (error) {
			// Uma configuração inválida não significa estar dentro nem fora do horário.
			throw new NodeOperationError(this.getNode(), error as Error, {
				itemIndex,
			});
		}
	}
	return outputs;
}
