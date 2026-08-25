import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
} from 'n8n-workflow';

export async function underChatApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('underChatApi');
	const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
	};

	if (Object.keys(body).length > 0) options.body = body;
	if (Object.keys(qs).length > 0) options.qs = qs;

	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'underChatApi',
		options,
	)) as IDataObject;
}

export function responseData(response: IDataObject): unknown {
	return response.data ?? response;
}

export function firstRecord(response: IDataObject): IDataObject | undefined {
	const data = responseData(response);
	if (Array.isArray(data)) return data[0] as IDataObject | undefined;
	if (data && typeof data === 'object') {
		const record = data as IDataObject;
		if (Array.isArray(record.items)) return record.items[0] as IDataObject | undefined;
		return record;
	}
	return undefined;
}

export function getOpaqueId(record: IDataObject | undefined, names: string[]): string | undefined {
	if (!record) return undefined;
	for (const name of names) {
		const value = record[name];
		if (typeof value === 'string' || typeof value === 'number') return String(value);
	}
	return undefined;
}

export function parseJsonObject(value: string): IDataObject {
	if (!value.trim()) return {};
	const parsed = JSON.parse(value) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
	return parsed as IDataObject;
}

export function isNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const candidate = error as {
		httpCode?: string | number;
		statusCode?: string | number;
		response?: { status?: string | number; statusCode?: string | number };
		cause?: { response?: { status?: string | number; statusCode?: string | number } };
	};
	const statuses = [
		candidate.httpCode,
		candidate.statusCode,
		candidate.response?.status,
		candidate.response?.statusCode,
		candidate.cause?.response?.status,
		candidate.cause?.response?.statusCode,
	];
	return statuses.some((status) => String(status) === '404');
}

export function parseJsonArray(value: string): IDataObject[] {
	if (!value.trim()) return [];
	const parsed = JSON.parse(value) as unknown;
	if (!Array.isArray(parsed)) return [];
	return parsed as IDataObject[];
}

export function withoutEmptyValues(object: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(object).filter(([, value]) => value !== '' && value !== undefined),
	);
}
