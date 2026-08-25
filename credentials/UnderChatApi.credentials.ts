import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class UnderChatApi implements ICredentialType {
	name = 'underChatApi';

	displayName = 'UnderChat API';

	icon = 'file:../nodes/UnderChat/underchat-logo.svg' as const;

	documentationUrl = 'https://docs.underchat.com.br/guias/primeiros-passos';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Token gerado em Integração → API pública no painel da UnderChat',
		},
		{
			displayName: 'ID do Usuário Executor',
			name: 'userId',
			type: 'string',
			default: '',
			required: true,
			description: 'UUID do usuário que executará as operações e cujas permissões serão aplicadas',
		},
		{
			displayName: 'URL Base',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api-public.underchat.com.br/v1',
			required: true,
			description: 'Altere somente para usar outro ambiente da UnderChat',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				keyapi: '={{$credentials.apiKey}}',
				'x-underchat-user-id': '={{$credentials.userId}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}',
			url: '/chat',
			qs: { status: 'my_chats', per_page: 1 },
		},
	};
}
