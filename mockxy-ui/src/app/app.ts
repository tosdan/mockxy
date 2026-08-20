import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopBar } from './shared/top-bar';
import { UiToaster } from './ui/ui-toast/ui-toast';
import { UpdateNotification } from './shared/update-notification';
import { ViewRail } from './shared/view-rail';
import { StatusBar } from './shared/status-bar';

/**
 * Shell applicativa: una barra in cima (workspace + stato runtime), il rail delle view a sinistra,
 * la pagina instradata al centro e la status bar del workspace in fondo. Il toaster è montato qui
 * una sola volta.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopBar, UpdateNotification, ViewRail, StatusBar, UiToaster],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App { }
