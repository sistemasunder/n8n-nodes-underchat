import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

export async function underChatApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
	executorId?: string,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('underChatApi');
	const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
	const legacyExecutorId = typeof credentials.userId === 'string' ? credentials.userId : '';
	const resolvedExecutorId = executorId || legacyExecutorId;
	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
	};
	if (endpoint !== '/user/all' && resolvedExecutorId) {
		options.headers = { 'x-underchat-user-id': resolvedExecutorId };
	}

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

export function collectionRecords(value: unknown): IDataObject[] {
	if (Array.isArray(value)) {
		return value.filter(
			(item): item is IDataObject => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
		);
	}
	if (!value || typeof value !== 'object') return [];

	const record = value as IDataObject;
	for (const key of ['data', 'results', 'items', 'users', 'sectors', 'workers']) {
		const nested = record[key];
		if (nested !== undefined && nested !== value) {
			const records = collectionRecords(nested);
			if (records.length > 0) return records;
		}
	}
	return [];
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
