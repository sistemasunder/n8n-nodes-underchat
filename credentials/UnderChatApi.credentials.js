"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnderChatApi = void 0;
class UnderChatApi {
    constructor() {
        this.name = 'underChatApi';
        this.displayName = 'UnderChat API';
        this.icon = 'file:../nodes/UnderChat/underchat.svg';
        this.documentationUrl = 'https://docs.underchat.com.br/guias/primeiros-passos';
        this.properties = [
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
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    keyapi: '={{$credentials.apiKey}}',
                    'x-underchat-user-id': '={{$credentials.userId}}',
                },
            },
        };
        this.test = {
            request: {
                baseURL: '={{$credentials.baseUrl.replace(/\\/$/, "")}}',
                url: '/chat',
                qs: { status: 'my_chats', per_page: 1 },
            },
        };
    }
}
exports.UnderChatApi = UnderChatApi;
