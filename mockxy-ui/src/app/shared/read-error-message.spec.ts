import { isEndpointExistsError, isReservedCollectionLabelError } from './read-error-message';

describe('read-error-message', () => {
  // Il 409 di creazione o duplicazione su un metodo+path gia' occupato: la GUI lo traduce.
  it('riconosce un 409 ENDPOINT_EXISTS dal codice, non dal messaggio', () => {
    const conflict = { status: 409, error: { message: 'An endpoint already exists for this folder and method.', details: { code: 'ENDPOINT_EXISTS' } } };
    expect(isEndpointExistsError(conflict)).toBe(true);
    expect(isEndpointExistsError({ status: 409, error: { message: 'An endpoint already exists for this folder and method.' } })).toBe(false);
    expect(isEndpointExistsError({ status: 409, error: { details: { code: 'COLLECTION_LABEL_RESERVED' } } })).toBe(false);
    expect(isReservedCollectionLabelError(conflict)).toBe(false);
    expect(isEndpointExistsError(null)).toBe(false);
  });
});
