# The UI language

The interface is available in **Italian and English**; you change it from the selector in the
top bar, with immediate effect and no restarts.

Where the choice lives depends on how you use Mockxy:

- **in the browser** (headless server or development): on first access the language follows the
  browser's locale; an explicit choice is then remembered by the browser itself, per machine;
- **in the desktop app**: the choice is saved in the global preferences next to the executable,
  applies to every workspace and is shared between the application and the welcome screen.
  It also covers the **native dialogs** (close confirmations, workspace initialization), which
  switch language at runtime together with everything else.

The language only concerns the interface: the engine's log messages stay in English,
regardless of the choice.
