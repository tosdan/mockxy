import { TestBed } from '@angular/core/testing';
import { HttpStatusCodesService } from './http-status-codes.service';

describe('HttpStatusCodesService', () => {
  let service: HttpStatusCodesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HttpStatusCodesService);
  });

  it('should list known 2xx, 3xx, 4xx and 5xx status codes', () => {
    const codes = service.all().map((option) => option.code);

    expect(codes).toContain(200);
    expect(codes).toContain(308);
    expect(codes).toContain(404);
    expect(codes).toContain(511);
  });

  it('should search by code, description and complete label', () => {
    expect(service.search('404').map((option) => option.code)).toEqual([404]);
    expect(service.search('gateway').map((option) => option.code)).toEqual([502, 504]);
    expect(service.search('200 ok').map((option) => option.code)).toEqual([200]);
  });

  it('should return a fresh list instance for dropdown searches', () => {
    expect(service.search('')).toEqual(service.all());
    expect(service.search('')).not.toBe(service.search(''));
  });
});
