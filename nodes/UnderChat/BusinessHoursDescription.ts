import type { INodeProperties } from 'n8n-workflow';

const showBusinessHours = {
	show: { resource: ['businessHours'] },
	hide: { '@tool': [true] },
};

export const businessHoursProperties: INodeProperties[] = [
	{
		displayName: 'Operação',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Verificar Horário',
				value: 'checkBusinessHours',
				action: 'Verificar dias e horas de funcionamento',
				description:
					'Encaminha cada item para Dentro do horário ou Fora do horário',
			},
		],
		default: 'checkBusinessHours',
		displayOptions: showBusinessHours,
	},
	{
		displayName:
			'Configure a agenda neste node, sem API Key ou executor. Os dados recebidos são preservados nas duas saídas. Para usar como condição, mantenha Always Output Data desativado e On Error em Stop Workflow.',
		name: 'businessHoursNotice',
		type: 'notice',
		default: '',
		displayOptions: showBusinessHours,
	},
	{
		displayName: 'Fuso Horário',
		name: 'businessHoursTimezone',
		type: 'options',
		options: [
			{ name: 'Brasília (America/Sao_Paulo)', value: 'America/Sao_Paulo' },
			{ name: 'Fuso Do Workflow', value: 'workflow' },
			{ name: 'Outro Fuso', value: 'custom' },
			{ name: 'UTC', value: 'UTC' },
		],
		default: 'America/Sao_Paulo',
		description: 'Fuso usado para verificar o dia da semana e o horário atual',
		displayOptions: showBusinessHours,
	},
	{
		displayName: 'Fuso Personalizado',
		name: 'businessHoursCustomTimezone',
		type: 'string',
		default: '',
		placeholder: 'America/Manaus',
		required: true,
		description:
			'Nome IANA do fuso horário, por exemplo America/Manaus ou Europe/Lisbon',
		displayOptions: {
			show: { resource: ['businessHours'], businessHoursTimezone: ['custom'] },
			hide: { '@tool': [true] },
		},
	},
	{
		displayName: 'Faixas De Horário',
		name: 'businessHoursRules',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Adicionar Faixa De Horário',
		default: {},
		description:
			'Adicione uma faixa para cada período permitido. Qualquer faixa correspondente libera a saída Dentro do horário; dias sem faixas seguem por Fora do horário.',
		displayOptions: showBusinessHours,
		options: [
			{
				name: 'rules',
				displayName: 'Faixa',
				values: [
					{
						displayName: 'Dias Da Semana',
						name: 'days',
						type: 'multiOptions',
						options: [
							{ name: 'Segunda-Feira', value: 1 },
							{ name: 'Terça-Feira', value: 2 },
							{ name: 'Quarta-Feira', value: 3 },
							{ name: 'Quinta-Feira', value: 4 },
							{ name: 'Sexta-Feira', value: 5 },
							{ name: 'Sábado', value: 6 },
							{ name: 'Domingo', value: 7 },
						],
						default: [1, 2, 3, 4, 5],
						required: true,
						description: 'Selecione os dias em que esta faixa começa',
					},
					{
						displayName: 'Dia Inteiro',
						name: 'allDay',
						type: 'boolean',
						default: false,
					},
					{
						displayName: 'Início',
						name: 'startTime',
						type: 'string',
						default: '08:00',
						placeholder: 'HH:mm',
						required: true,
						description: 'Hora local de início, por exemplo 08:00 ou 12:01',
						displayOptions: { hide: { allDay: [true] } },
					},
					{
						displayName: 'Fim',
						name: 'endTime',
						type: 'string',
						default: '17:59',
						placeholder: 'HH:mm',
						required: true,
						description:
							'O minuto final inteiro é incluído: 17:59 vale até 17:59:59. Se o fim for anterior ao início, a faixa termina no dia seguinte.',
						displayOptions: { hide: { allDay: [true] } },
					},
				],
			},
		],
	},
];
