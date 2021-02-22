import {
  App,
  MarkdownView,
  Plugin,
  PluginManifest,
  PluginSettingTab,
  Setting,
} from "obsidian";
import * as prettier from "prettier";
import markdown from "prettier/parser-markdown";

export interface CursorPosition {
  line: number;
  ch: number;
}

interface Hotkey {
  modifiers: ("Mod" | "Shift" | "Alt" | "Ctrl")[];
  key: string;
}

type HotkeyMap = Record<string, Hotkey[]>;

interface HotkeyManager {
  customKeys?: HotkeyMap;
  defaultKeys: HotkeyMap;
}

const positionToCursorOffset = (
  code: string,
  { line, ch }: CursorPosition
): number => {
  return code.split("\n").reduce((pos, currLine, index) => {
    if (index < line) {
      return pos + currLine.length + 1;
    }

    if (index === line) {
      return pos + ch;
    }

    return pos;
  }, 0);
};

const cursorOffsetToPosition = (
  code: string,
  cursorOffset: number
): CursorPosition => {
  const substring = code.slice(0, cursorOffset);
  const line = substring.split("\n").length - 1;
  const indexOfLastLine = substring.lastIndexOf("\n");

  return {
    line,
    ch: cursorOffset - indexOfLastLine - 1,
  };
};

class PrettierFormatSettingsTab extends PluginSettingTab {
  private readonly plugin: PrettierPlugin;

  constructor(app: App, plugin: PrettierPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Prettier Format - Settings" });

    new Setting(containerEl)
      .setName("Format on Save")
      .setDesc(
        "If enabled, format the current note when you save the file via hotkey"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.formatOnSave || false)
          .onChange((value) => {
            this.plugin.settings.formatOnSave = value;
            this.plugin.saveData(this.plugin.settings);
            this.display();
          })
      );
  }
}

interface PrettierPluginSettings {
  formatOnSave?: boolean;
}

export default class PrettierPlugin extends Plugin {
  public settings: PrettierPluginSettings = {};
  private saveHotkey: Hotkey[] | undefined;

  public async onload(): Promise<void> {
    console.log("Load Prettier Format plugin");

    this.settings = {
      ...(await this.loadData()),
    };

    this.addCommand({
      id: "format-note",
      name: "Format the entire note",
      callback: this.formatAll,
    });

    this.addCommand({
      id: "format-selection",
      name: "Format the just the selection in the note",
      callback: () => {
        const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (activeLeaf instanceof MarkdownView) {
          const editor = activeLeaf.sourceMode.cmEditor;
          const text = editor.getSelection();
          const formatted = prettier.format(text, {
            parser: "markdown",
            plugins: [markdown],
          });

          if (formatted === text) {
            return;
          }

          editor.replaceSelection(formatted);
        }
      },
    });

    this.addSettingTab(new PrettierFormatSettingsTab(this.app, this));

    this.registerCodeMirror((cm) => {
      cm.on("keydown", this.handleKeyDown);
    });

    const hotkeyManager: HotkeyManager = (this.app as any).hotkeyManager;
    const hotKeyEntry =
      (hotkeyManager.customKeys &&
        Object.entries(hotkeyManager.customKeys).find(
          ([name]) => name === "editor:save-file"
        )) ||
      Object.entries(hotkeyManager.defaultKeys).find(
        ([name]) => name === "editor:save-file"
      ) ||
      [];
    this.saveHotkey = hotKeyEntry[1];
  }

  public onunload(): void {
    console.log("Unloading Prettier Format plugin");

    this.app.workspace.iterateCodeMirrors((cm) => {
      cm.off("keydown", this.handleKeyDown);
    });
  }

  private readonly formatAll = (): void => {
    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (activeLeaf instanceof MarkdownView) {
      const editor = activeLeaf.sourceMode.cmEditor;
      const text = editor.getValue();
      const cursor = editor.getCursor();
      const position = positionToCursorOffset(text, cursor);
      const { formatted, cursorOffset } = prettier.formatWithCursor(text, {
        parser: "markdown",
        plugins: [markdown],
        cursorOffset: position,
      });

      if (formatted === text) {
        return;
      }

      editor.setValue(formatted);
      editor.setCursor(cursorOffsetToPosition(formatted, cursorOffset));
      const { left, top } = editor.getScrollInfo();
      editor.scrollTo(left, top);
    }
  };

  private readonly handleKeyDown = (
    cm: CodeMirror.Editor,
    event: KeyboardEvent
  ): void => {
    if (!this.saveHotkey) {
      return;
    }

    const wasSave = this.saveHotkey.some((hotkey) => {
      const hasAllModifiers = hotkey.modifiers.every((modifier) => {
        if (modifier === "Mod") {
          return event.metaKey;
        }

        if (modifier === "Shift") {
          return event.shiftKey;
        }

        if (modifier === "Ctrl") {
          return event.ctrlKey;
        }

        if (modifier === "Alt") {
          return event.altKey;
        }
      });

      return (
        event.key.toLowerCase() === hotkey.key.toLowerCase() && hasAllModifiers
      );
    });

    if (this.settings.formatOnSave && wasSave) {
      this.formatAll();
    }
  };
}
