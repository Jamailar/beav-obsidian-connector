import { PluginSettingTab, Setting } from 'obsidian';

import type BeavConnectorPlugin from './main';

export class BeavConnectorSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: BeavConnectorPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Connection status')
      .setDesc(this.plugin.connectionDescription());

    new Setting(containerEl)
      .setName('Reconnect to Beav')
      .setDesc('Reconnect this vault to the Beav desktop app running on this computer.')
      .addButton((button) => button
        .setButtonText('Reconnect')
        .onClick(() => this.plugin.reconnect()));

    new Setting(containerEl)
      .setName('Reset pairing')
      .setDesc('Remove this vault’s local pairing credential. The next connection must be approved by Beav.')
      .addButton((button) => button
        .setWarning()
        .setButtonText('Reset')
        .onClick(async () => {
          await this.plugin.resetPairing();
          this.display();
        }));
  }
}
