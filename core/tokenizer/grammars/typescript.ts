import { parser as jsParser } from '@lezer/javascript';

export const typescriptParser = jsParser.configure({
  dialect: 'ts jsx',
});

export const javascriptParser = jsParser.configure({
  dialect: 'jsx',
});
