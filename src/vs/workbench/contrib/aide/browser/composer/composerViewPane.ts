/*---------------------------------------------------------------------------------------------
 *  AIDE - AI Development Environment
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IViewPaneOptions, ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ComposerWidget } from './composerWidget.js';
import { $, append } from '../../../../../base/browser/dom.js';

export class ComposerViewPane extends ViewPane {
	static readonly ID = 'workbench.view.aide.composer';
	static readonly TITLE = 'AIDE';

	private _composerWidget: ComposerWidget | undefined;
	private _container: HTMLElement | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = append(container, $('.aide-composer-container'));
		this._container.style.height = '100%';
		this._container.style.display = 'flex';
		this._container.style.flexDirection = 'column';

		this._composerWidget = this._register(
			this.instantiationService.createInstance(ComposerWidget, this._container)
		);

		// Create initial agent if none exists
		this._composerWidget.createNewAgent();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		if (this._container) {
			this._container.style.height = `${height}px`;
			this._container.style.width = `${width}px`;
		}
	}

	override focus(): void {
		super.focus();
		this._composerWidget?.focus();
	}

	public getComposerWidget(): ComposerWidget | undefined {
		return this._composerWidget;
	}
}
