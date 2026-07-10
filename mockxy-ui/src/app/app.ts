import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WorkspaceBar } from './shared/workspace-bar';
import { RuntimeBar } from './shared/runtime-bar';
import { UiToaster } from './ui/ui-toast/ui-toast';

/**
 * Shell applicativa: barra workspace (solo app desktop) e barra di stato runtime globale
 * (server/proxy/monitor/dump) montate una volta in cima, poi la pagina instradata riempie lo spazio
 * sottostante. Il toaster è montato qui una sola volta.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, WorkspaceBar, RuntimeBar, UiToaster],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App { }
