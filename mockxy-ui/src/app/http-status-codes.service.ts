import { Injectable } from '@angular/core';

export interface HttpStatusCodeOption {
  code: number;
  description: string;
  label: string;
}

const HTTP_STATUS_CODES: HttpStatusCodeOption[] = [
  { code: 200, description: 'OK', label: '200 OK' },
  { code: 201, description: 'Created', label: '201 Created' },
  { code: 202, description: 'Accepted', label: '202 Accepted' },
  { code: 203, description: 'Non-Authoritative Information', label: '203 Non-Authoritative Information' },
  { code: 204, description: 'No Content', label: '204 No Content' },
  { code: 205, description: 'Reset Content', label: '205 Reset Content' },
  { code: 206, description: 'Partial Content', label: '206 Partial Content' },
  { code: 207, description: 'Multi-Status', label: '207 Multi-Status' },
  { code: 208, description: 'Already Reported', label: '208 Already Reported' },
  { code: 226, description: 'IM Used', label: '226 IM Used' },
  { code: 300, description: 'Multiple Choices', label: '300 Multiple Choices' },
  { code: 301, description: 'Moved Permanently', label: '301 Moved Permanently' },
  { code: 302, description: 'Found', label: '302 Found' },
  { code: 303, description: 'See Other', label: '303 See Other' },
  { code: 304, description: 'Not Modified', label: '304 Not Modified' },
  { code: 305, description: 'Use Proxy', label: '305 Use Proxy' },
  { code: 306, description: 'Unused', label: '306 Unused' },
  { code: 307, description: 'Temporary Redirect', label: '307 Temporary Redirect' },
  { code: 308, description: 'Permanent Redirect', label: '308 Permanent Redirect' },
  { code: 400, description: 'Bad Request', label: '400 Bad Request' },
  { code: 401, description: 'Unauthorized', label: '401 Unauthorized' },
  { code: 402, description: 'Payment Required', label: '402 Payment Required' },
  { code: 403, description: 'Forbidden', label: '403 Forbidden' },
  { code: 404, description: 'Not Found', label: '404 Not Found' },
  { code: 405, description: 'Method Not Allowed', label: '405 Method Not Allowed' },
  { code: 406, description: 'Not Acceptable', label: '406 Not Acceptable' },
  { code: 407, description: 'Proxy Authentication Required', label: '407 Proxy Authentication Required' },
  { code: 408, description: 'Request Timeout', label: '408 Request Timeout' },
  { code: 409, description: 'Conflict', label: '409 Conflict' },
  { code: 410, description: 'Gone', label: '410 Gone' },
  { code: 411, description: 'Length Required', label: '411 Length Required' },
  { code: 412, description: 'Precondition Failed', label: '412 Precondition Failed' },
  { code: 413, description: 'Content Too Large', label: '413 Content Too Large' },
  { code: 414, description: 'URI Too Long', label: '414 URI Too Long' },
  { code: 415, description: 'Unsupported Media Type', label: '415 Unsupported Media Type' },
  { code: 416, description: 'Range Not Satisfiable', label: '416 Range Not Satisfiable' },
  { code: 417, description: 'Expectation Failed', label: '417 Expectation Failed' },
  { code: 418, description: "I'm a teapot", label: "418 I'm a teapot" },
  { code: 421, description: 'Misdirected Request', label: '421 Misdirected Request' },
  { code: 422, description: 'Unprocessable Content', label: '422 Unprocessable Content' },
  { code: 423, description: 'Locked', label: '423 Locked' },
  { code: 424, description: 'Failed Dependency', label: '424 Failed Dependency' },
  { code: 425, description: 'Too Early', label: '425 Too Early' },
  { code: 426, description: 'Upgrade Required', label: '426 Upgrade Required' },
  { code: 428, description: 'Precondition Required', label: '428 Precondition Required' },
  { code: 429, description: 'Too Many Requests', label: '429 Too Many Requests' },
  { code: 431, description: 'Request Header Fields Too Large', label: '431 Request Header Fields Too Large' },
  { code: 451, description: 'Unavailable For Legal Reasons', label: '451 Unavailable For Legal Reasons' },
  { code: 500, description: 'Internal Server Error', label: '500 Internal Server Error' },
  { code: 501, description: 'Not Implemented', label: '501 Not Implemented' },
  { code: 502, description: 'Bad Gateway', label: '502 Bad Gateway' },
  { code: 503, description: 'Service Unavailable', label: '503 Service Unavailable' },
  { code: 504, description: 'Gateway Timeout', label: '504 Gateway Timeout' },
  { code: 505, description: 'HTTP Version Not Supported', label: '505 HTTP Version Not Supported' },
  { code: 506, description: 'Variant Also Negotiates', label: '506 Variant Also Negotiates' },
  { code: 507, description: 'Insufficient Storage', label: '507 Insufficient Storage' },
  { code: 508, description: 'Loop Detected', label: '508 Loop Detected' },
  { code: 510, description: 'Not Extended', label: '510 Not Extended' },
  { code: 511, description: 'Network Authentication Required', label: '511 Network Authentication Required' },
];

@Injectable({
  providedIn: 'root',
})
export class HttpStatusCodesService {
  private readonly options = HTTP_STATUS_CODES;
  private readonly optionsByCode = new Map(this.options.map((option) => [option.code, option]));

  all(): HttpStatusCodeOption[] {
    return [...this.options];
  }

  findByCode(code: number | null | undefined): HttpStatusCodeOption | undefined {
    return code == null ? undefined : this.optionsByCode.get(code);
  }

  search(query: string | null | undefined): HttpStatusCodeOption[] {
    const normalizedQuery = (query ?? '').trim().toLowerCase();
    if (normalizedQuery === '') {
      return this.all();
    }

    return this.options.filter((option) => {
      const code = String(option.code);
      return code.includes(normalizedQuery)
        || option.description.toLowerCase().includes(normalizedQuery)
        || option.label.toLowerCase().includes(normalizedQuery);
    });
  }
}
