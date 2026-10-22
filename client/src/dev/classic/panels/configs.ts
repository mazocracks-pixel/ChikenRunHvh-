import { renderConfigsPanel } from '../../panels/configs';
import { BUILTIN_CONFIGS, configPrint, exportConfig, importConfig, resetConfig, sanitizeConfig } from '../config';
import type { Dev } from '../Dev';

export const configsPanel = (dev: Dev) => renderConfigsPanel(dev, { sanitizeConfig, importConfig, exportConfig, builtins: { list: BUILTIN_CONFIGS, reset: resetConfig, print: configPrint } });
