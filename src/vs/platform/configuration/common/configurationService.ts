/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ConfigurationTarget, IConfigurationChange, IConfigurationChangeEvent, IConfigurationData, IConfigurationOverrides, IConfigurationService, IConfigurationValue, isConfigurationOverrides } from 'vs/platform/configuration/common/configuration';
import { Configuration, ConfigurationChangeEvent, ConfigurationModel, DefaultConfigurationModel, UserSettings } from 'vs/platform/configuration/common/configurationModels';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IFileService } from 'vs/platform/files/common/files';
import { Registry } from 'vs/platform/registry/common/platform';
import { IUserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';

export class ConfigurationService extends Disposable implements IConfigurationService, IDisposable {

	declare readonly _serviceBrand: undefined;

	private configuration: Configuration;
	private userConfiguration: MutableDisposable<UserSettings>;
	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	private readonly _onDidChangeConfiguration: Emitter<IConfigurationChangeEvent> = this._register(new Emitter<IConfigurationChangeEvent>());
	readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

	constructor(
		private readonly userDataProfilesService: IUserDataProfilesService,
		private readonly fileService: IFileService
	) {
		super();
		this.configuration = new Configuration(new DefaultConfigurationModel(), new ConfigurationModel());
		this.userConfiguration = this._register(new MutableDisposable<UserSettings>());

		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this.reloadConfiguration(), 50));
		this._register(Registry.as<IConfigurationRegistry>(Extensions.Configuration).onDidUpdateConfiguration(({ properties }) => this.onDidDefaultConfigurationChange(properties)));
	}

	private initPromise: Promise<void> | undefined;
	initialize(settingsResource?: URI): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = (async () => {
				this.userConfiguration.value = new UserSettings(settingsResource ?? this.userDataProfilesService.currentProfile.settingsResource, undefined, extUriBiasedIgnorePathCase, this.fileService);
				this._register(this.userConfiguration.value.onDidChange(() => this.reloadConfigurationScheduler.schedule()));
				const userConfiguration = await this.userConfiguration.value.loadConfiguration();
				this.configuration = new Configuration(new DefaultConfigurationModel(), userConfiguration);
			})();
		}
		return this.initPromise;
	}

	getConfigurationData(): IConfigurationData {
		return this.configuration.toData();
	}

	getValue<T>(): T;
	getValue<T>(section: string): T;
	getValue<T>(overrides: IConfigurationOverrides): T;
	getValue<T>(section: string, overrides: IConfigurationOverrides): T;
	getValue(arg1?: any, arg2?: any): any {
		const section = typeof arg1 === 'string' ? arg1 : undefined;
		const overrides = isConfigurationOverrides(arg1) ? arg1 : isConfigurationOverrides(arg2) ? arg2 : {};
		return this.configuration.getValue(section, overrides, undefined);
	}

	updateValue(key: string, value: any): Promise<void>;
	updateValue(key: string, value: any, overrides: IConfigurationOverrides): Promise<void>;
	updateValue(key: string, value: any, target: ConfigurationTarget): Promise<void>;
	updateValue(key: string, value: any, overrides: IConfigurationOverrides, target: ConfigurationTarget): Promise<void>;
	updateValue(key: string, value: any, arg3?: any, arg4?: any): Promise<void> {
		return Promise.reject(new Error('not supported'));
	}

	inspect<T>(key: string): IConfigurationValue<T> {
		return this.configuration.inspect<T>(key, {}, undefined);
	}

	keys(): {
		default: string[];
		user: string[];
		workspace: string[];
		workspaceFolder: string[];
	} {
		return this.configuration.keys(undefined);
	}

	async reloadConfiguration(): Promise<void> {
		if (this.userConfiguration.value) {
			const configurationModel = await this.userConfiguration.value.loadConfiguration();
			this.onDidChangeUserConfiguration(configurationModel);
		}
	}

	private onDidChangeUserConfiguration(userConfigurationModel: ConfigurationModel): void {
		const previous = this.configuration.toData();
		const change = this.configuration.compareAndUpdateLocalUserConfiguration(userConfigurationModel);
		this.trigger(change, previous, ConfigurationTarget.USER);
	}

	private onDidDefaultConfigurationChange(properties: string[]): void {
		const previous = this.configuration.toData();
		const change = this.configuration.compareAndUpdateDefaultConfiguration(new DefaultConfigurationModel(), properties);
		this.trigger(change, previous, ConfigurationTarget.DEFAULT);
	}

	private trigger(configurationChange: IConfigurationChange, previous: IConfigurationData, source: ConfigurationTarget): void {
		const event = new ConfigurationChangeEvent(configurationChange, { data: previous }, this.configuration);
		event.source = source;
		event.sourceConfig = this.getTargetConfiguration(source);
		this._onDidChangeConfiguration.fire(event);
	}

	private getTargetConfiguration(target: ConfigurationTarget): any {
		switch (target) {
			case ConfigurationTarget.DEFAULT:
				return this.configuration.defaults.contents;
			case ConfigurationTarget.USER:
				return this.configuration.localUserConfiguration.contents;
		}
		return {};
	}
}
