export * from './other';
export { thing } from './thing';

export interface User {
  id: string;
  name: string;
}

export type Role = 'admin' | 'user';

export enum Status {
  Active,
  Disabled,
}

const enum Flags {
  A = 1,
}

declare const ambient: string;
