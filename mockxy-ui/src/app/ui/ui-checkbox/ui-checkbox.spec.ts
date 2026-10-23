import '@angular/compiler';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiCheckbox } from './ui-checkbox';

@Component({
  imports: [UiCheckbox],
  template: `<ui-checkbox ariaLabel="Copia tutte le response" />`,
})
class Host {}

describe('UiCheckbox', () => {
  it("l'etichetta arriva al button con role=checkbox, non all'host", () => {
    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const box = host.querySelector('[role="checkbox"]');
    expect(box?.tagName).toBe('BUTTON');
    expect(box?.getAttribute('aria-label')).toBe('Copia tutte le response');
    expect(host.querySelector('brn-checkbox')?.hasAttribute('aria-label')).toBe(false);
  });
});
