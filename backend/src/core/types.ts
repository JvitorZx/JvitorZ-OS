export interface CoreConfig {
  appName: string;
  version: string;
  environment: string;
}

export interface ModuleOptions {
  enabled?: boolean;
}

export interface ModuleConstructor {
  new (...args: unknown[]): any;
}
