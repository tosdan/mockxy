import type { FormControl, FormGroup } from '@angular/forms';

export type AppPage = 'mocks' | 'monitor';

export type DrawerMode =
  | 'view'
  | 'create'
  | 'edit'
  | 'edit-endpoint'
  | 'create-handler'
  | 'edit-handler'
  | 'create-middleware'
  | 'edit-middleware'
  | 'edit-response'
  | 'edit-response-handler'
  | 'edit-response-middleware';

export type MockFormGroup = FormGroup<{
  method: FormControl<string>;
  path: FormControl<string>;
  status: FormControl<number>;
  disabled: FormControl<boolean>;
  bodyFile: FormControl<string>;
  delayMs: FormControl<number>;
  headersJson: FormControl<string>;
  bodyJson: FormControl<string>;
}>;

export type HandlerFormGroup = FormGroup<{
  method: FormControl<string>;
  path: FormControl<string>;
  disabled: FormControl<boolean>;
  source: FormControl<string>;
}>;

export type EndpointFormGroup = FormGroup<{
  description: FormControl<string>;
}>;

export type ResponseMockFormGroup = FormGroup<{
  title: FormControl<string>;
  status: FormControl<number>;
  delayMs: FormControl<number>;
  headersJson: FormControl<string>;
  bodyJson: FormControl<string>;
}>;

export type ResponseScriptFormGroup = FormGroup<{
  title: FormControl<string>;
  source: FormControl<string>;
}>;
