# Mockxy UI

Interfaccia Angular per la gestione dei mock locali del progetto (Angular 21, Tailwind e componenti in stile shadcn/spartan-ng).

## Development server

To start a local development server, run:

```bash
npm start
```

The app runs on `http://localhost:4207/` and proxies `/_admin/api` to Mockxy on port `3000`.

## Docker

From the repository root you can run:

```bash
docker compose up --build
```

The standard compose stack starts this Angular app on `http://localhost:4207/` and the backend on `http://localhost:3000/`.

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
