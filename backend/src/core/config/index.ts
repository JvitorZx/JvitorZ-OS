import ConfigService from './ConfigService';
import Environment from './Environment';

const environment = new Environment();
const configService = new ConfigService(environment);

export { ConfigService, Environment, configService };
