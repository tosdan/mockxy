import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MockAdminApiService } from './mock-admin-api.service';

describe('MockAdminApiService', () => {
  let service: MockAdminApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(MockAdminApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('should load mock summaries', () => {
    service.listMocks().subscribe((response) => {
      expect(response.items).toHaveLength(1);
      expect(response.items[0].path).toBe('/mocked');
      expect(response.collections).toEqual([
        {
          id: 'collection-archived',
          label: 'Archiviati',
          itemCount: 1,
        },
      ]);
    });

    const request = http.expectOne('/_admin/api/mocks');
    expect(request.request.method).toBe('GET');
    request.flush({
      items: [
        {
          id: 'mocked',
          type: 'mock',
          method: 'GET',
          path: '/mocked',
          status: 200,
          disabled: false,
          configFilePath: 'mocked/GET.endpoint.json',
          payloadType: 'json',
        },
      ],
      collections: [
        {
          id: 'collection-archived',
          label: 'Archiviati',
          itemCount: 1,
        },
      ],
      folders: [
        {
          id: 'folder-id',
          folderPath: 'mocked',
          explicit: false,
          empty: false,
          editable: false,
        },
      ],
    });
  });

  it('should resolve a concrete request to the covering mock', () => {
    service.resolveMock('GET', '/users/42?x=1').subscribe((mock) => {
      expect(mock).toEqual({
        id: 'covering',
        type: 'mock',
        method: 'GET',
        path: '/users/:id',
        status: 200,
        disabled: false,
        configFilePath: 'users/{id}/GET.endpoint.json',
      });
    });

    const request = http.expectOne(
      (candidate) => candidate.url === '/_admin/api/mocks/resolve' && candidate.params.get('path') === '/users/42?x=1' && candidate.params.get('method') === 'GET',
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      mock: {
        id: 'covering',
        type: 'mock',
        method: 'GET',
        path: '/users/:id',
        status: 200,
        disabled: false,
        configFilePath: 'users/{id}/GET.endpoint.json',
      },
    });
  });

  it('should resolve to null when no mock covers the request', () => {
    service.resolveMock('GET', '/inesistente').subscribe((mock) => {
      expect(mock).toBeNull();
    });

    const request = http.expectOne((candidate) => candidate.url === '/_admin/api/mocks/resolve');
    request.flush({ mock: null });
  });

  it('should update a mock definition', () => {
    service
      .updateMock('abc/123', {
        config: {
          method: 'GET',
          path: '/mocked',
          status: 200,
          bodyFile: '001.response.json',
        },
        body: {
          ok: true,
        },
      })
      .subscribe((response) => {
        expect(response.id).toBe('abc/123');
      });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123');
    expect(request.request.method).toBe('PUT');
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 200,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should update endpoint metadata only', () => {
    service
      .updateEndpoint('abc/123', {
        description: 'Descrizione aggiornata',
        enabled: false,
      })
      .subscribe((response) => {
        expect(response.endpoint?.description).toBe('Descrizione aggiornata');
      });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/endpoint');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      description: 'Descrizione aggiornata',
      enabled: false,
    });
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 200,
      disabled: true,
      configFilePath: 'mocked/GET.endpoint.json',
      payloadType: 'json',
      editable: true,
      endpoint: {
        method: 'GET',
        path: '/mocked',
        description: 'Descrizione aggiornata',
        enabled: false,
        responseFiles: ['001.response.json'],
        selectedResponseFile: '001.response.json',
      },
    });
  });

  it('should create a middleware definition', () => {
    service
      .createMiddleware({
        type: 'middleware',
        definition: {
          method: 'GET',
          path: '/proxy-transform/:id',
          disabled: false,
        },
        source: 'module.exports = { async transformResponse() { return undefined; } };',
      })
      .subscribe((response) => {
        expect(response.type).toBe('middleware');
      });

    const request = http.expectOne('/_admin/api/mocks');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      type: 'middleware',
      definition: {
        method: 'GET',
        path: '/proxy-transform/:id',
        disabled: false,
      },
      source: 'module.exports = { async transformResponse() { return undefined; } };',
    });
    request.flush({
      id: 'middleware',
      type: 'middleware',
      method: 'GET',
      path: '/proxy-transform/:id',
      status: null,
      disabled: false,
      configFilePath: 'proxy-transform/GET.endpoint.json',
      editable: true,
    });
  });

  it('should select an endpoint response', () => {
    service
      .selectResponse('abc/123', {
        selectedResponseFile: '002.response.json',
      })
      .subscribe((response) => {
        expect(response.selectedResponseFile).toBe('002.response.json');
      });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      selectedResponseFile: '002.response.json',
    });
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 202,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      selectedResponseFile: '002.response.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should create an endpoint response', () => {
    service.createResponse('abc/123').subscribe((response) => {
      expect(response.selectedResponseFile).toBe('002.response.json');
    });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/responses');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 200,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      selectedResponseFile: '002.response.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should create an endpoint response with edited values', () => {
    service.createResponse('abc/123', {
      type: 'mock',
      title: 'Errore 500',
      status: 500,
      headers: {
        'content-type': 'application/json',
      },
      delayMs: 25,
      body: {
        error: true,
      },
    }).subscribe((response) => {
      expect(response.selectedResponseFile).toBe('002.response.json');
    });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/responses');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      type: 'mock',
      title: 'Errore 500',
      status: 500,
      headers: {
        'content-type': 'application/json',
      },
      delayMs: 25,
      body: {
        error: true,
      },
    });
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 500,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      selectedResponseFile: '002.response.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should update an endpoint response file', () => {
    service
      .updateResponse('abc/123', '001.response.json', {
        type: 'mock',
        title: 'Alternativa',
        status: 204,
        headers: {
          'content-type': 'application/json',
        },
        delayMs: 0,
        body: {
          ok: false,
        },
      })
      .subscribe((response) => {
        expect(response.selectedResponseFile).toBe('001.response.json');
      });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/responses/001.response.json');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      type: 'mock',
      title: 'Alternativa',
      status: 204,
      headers: {
        'content-type': 'application/json',
      },
      delayMs: 0,
      body: {
        ok: false,
      },
    });
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 204,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      selectedResponseFile: '001.response.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should delete an endpoint response file', () => {
    service.deleteResponse('abc/123', '002.response.json').subscribe((response) => {
      expect(response.selectedResponseFile).toBe('001.response.json');
    });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/responses/002.response.json');
    expect(request.request.method).toBe('DELETE');
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 200,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      selectedResponseFile: '001.response.json',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should assign a definition to another collection', () => {
    service
      .assignDefinitionCollection('abc/123', {
        collectionId: 'collection-archived',
      })
      .subscribe((response) => {
        expect(response.collectionId).toBe('collection-archived');
      });

    const request = http.expectOne('/_admin/api/mocks/abc%2F123/collection');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      collectionId: 'collection-archived',
    });
    request.flush({
      id: 'abc/123',
      type: 'mock',
      method: 'GET',
      path: '/mocked',
      status: 200,
      disabled: false,
      configFilePath: 'mocked/GET.endpoint.json',
      collectionId: 'collection-archived',
      payloadType: 'json',
      editable: true,
    });
  });

  it('should create a new collection', () => {
    service.createCollection({ label: 'Archiviati' }).subscribe((response) => {
      expect(response).toEqual({
        id: 'collection-archived',
        label: 'Archiviati',
        itemCount: 0,
      });
    });

    const request = http.expectOne('/_admin/api/mocks/collections');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      label: 'Archiviati',
    });
    request.flush({
      id: 'collection-archived',
      label: 'Archiviati',
      itemCount: 0,
    });
  });

  it('should delete a collection', () => {
    let completed = false;
    service.deleteCollection('collection/archived').subscribe(() => {
      completed = true;
    });

    const request = http.expectOne('/_admin/api/mocks/collections/collection%2Farchived');
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    expect(completed).toBe(true);
  });

  it('should erase a collection together with its contents', () => {
    service.eraseCollection('collection/archived').subscribe((response) => {
      expect(response).toEqual({ deleted: 3 });
    });

    const request = http.expectOne('/_admin/api/mocks/collections/collection%2Farchived/contents');
    expect(request.request.method).toBe('DELETE');
    request.flush({ deleted: 3 });
  });
});
