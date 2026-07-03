import { createContext } from 'react';
import { themeFor, type Theme } from '../../shared/theme';

export const ThemeCtx = createContext<Theme>(themeFor('dark'));
