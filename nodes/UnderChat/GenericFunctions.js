"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.underChatApiRequest = underChatApiRequest;
exports.responseData = responseData;
exports.firstRecord = firstRecord;
exports.getOpaqueId = getOpaqueId;
exports.parseJsonObject = parseJsonObject;
exports.parseJsonArray = parseJsonArray;
exports.withoutEmptyValues = withoutEmptyValues;
async function underChatApiRequest(method, endpoint, body = {}, qs = {}) {
    const credentials = await this.getCredentials('underChatApi');
    const baseUrl = String(credentials.baseUrl).replace(/\/$/, '');
    const options = {
        method,
        url: `${baseUrl}${endpoint}`,
        json: true,
    };
    if (Object.keys(body).length > 0)
        options.body = body;
    if (Object.keys(qs).length > 0)
        options.qs = qs;
    return (await this.helpers.httpRequestWithAuthentication.call(this, 'underChatApi', options));
}
function responseData(response) {
    return response.data ?? response;
}
function firstRecord(response) {
    const data = responseData(response);
    if (Array.isArray(data))
        return data[0];
    if (data && typeof data === 'object') {
        const record = data;
        if (Array.isArray(record.items))
            return record.items[0];
        return record;
    }
    return undefined;
}
function getOpaqueId(record, names) {
    if (!record)
        return undefined;
    for (const name of names) {
        const value = record[name];
        if (typeof value === 'string' || typeof value === 'number')
            return String(value);
    }
    return undefined;
}
function parseJsonObject(value) {
    if (!value.trim())
        return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
    return parsed;
}
function parseJsonArray(value) {
    if (!value.trim())
        return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed))
        return [];
    return parsed;
}
function withoutEmptyValues(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== '' && value !== undefined));
}
